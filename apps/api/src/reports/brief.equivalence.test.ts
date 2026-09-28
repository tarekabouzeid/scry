/**
 * The brief used to load every initiative and compute each section in
 * memory. It now asks the database one question per section and fetches
 * only the rows it shows. This proves the two agree: `legacyBrief` is the
 * old algorithm verbatim (over plain arrays instead of tables), and
 * `MemorySource` answers each BriefSource question the way its SQL does.
 * Random datasets go through both, for every period and scope.
 */
import { describe, expect, it } from "vitest";
import {
  DEMAND_STALE_AFTER_DAYS,
  type BriefChange,
  type BriefDecision,
  type BriefEmerging,
  type BriefInitiativeRef,
  type BriefOverlap,
  type BriefStale,
  type BriefTeamRow,
  type BriefTheme,
  type BriefWant,
  type BriefWanted,
  type InitiativeStatus,
  type PortfolioBrief,
} from "@scry/shared";
import type { BriefQuery, BriefSource, BriefThemeRow, BriefWantRow, Dated } from "./brief-source";
import { classifyMove, computeBrief } from "./brief";
import { briefSummary } from "./summary";

// ------------------------------------------------------------------ data

type Tier = "strategic" | "tactical";
interface Data {
  teams: { id: string; name: string; orgUnit: string | null; status: "active" | "pending" }[];
  users: { id: string; name: string }[];
  initiatives: {
    id: string;
    title: string;
    teamId: string;
    status: InitiativeStatus;
    tier: Tier;
    tags: string[];
    contactPerson: string;
    createdAt: Date;
    updatedAt: Date;
    mergedIntoId: string | null;
  }[];
  edges: {
    from: string;
    to: string;
    type: "builds_on" | "replaces" | "related";
    createdAt: Date;
  }[];
  overlaps: {
    id: string;
    initiativeAId: string;
    initiativeBId: string;
    score: number;
    status: "open" | "merged" | "linked" | "dismissed";
    createdAt: Date;
    updatedAt: Date;
  }[];
  signals: {
    initiativeId: string;
    teamId: string;
    note: string | null;
    createdAt: Date;
    confirmedAt: Date;
  }[];
  /** status_changed activity only. */
  activity: {
    id: string;
    initiativeId: string;
    data: { from?: InitiativeStatus; to?: InitiativeStatus };
    createdAt: Date;
  }[];
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const STATUSES: InitiativeStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "on_hold",
  "shipped",
  "cancelled",
];
const TAGS = ["analytics", "dashboards", "fraud", "risk", "ledger", "sdk", "ml", "identity"];

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(seed: number): Data {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const used = new Set<number>();
  // Every event gets its own millisecond, so no ordering depends on ties.
  const when = (maxDaysAgo: number, after?: Date) => {
    for (;;) {
      const lo = after ? after.getTime() : NOW - maxDaysAgo * DAY;
      const t = Math.floor(lo + r() * (NOW - lo));
      if (!used.has(t)) {
        used.add(t);
        return new Date(t);
      }
    }
  };
  const uuid = (prefix: string, n: number) =>
    `${prefix}${n.toString(16).padStart(7, "0")}-0000-4000-8000-000000000000`;

  const teams: Data["teams"] = Array.from({ length: 6 }, (_, n) => ({
    id: uuid("a", n),
    name: `Team ${String.fromCharCode(65 + n)}`,
    orgUnit: n === 5 ? null : n % 2 ? "Product" : "Engineering",
    status: n === 4 ? "pending" : "active",
  }));
  const users = Array.from({ length: 8 }, (_, n) => ({ id: uuid("b", n), name: `Person ${n}` }));

  const initiatives: Data["initiatives"] = Array.from({ length: 45 }, (_, n) => {
    const createdAt = when(500);
    const tags = [...new Set(Array.from({ length: Math.floor(r() * 3) }, () => pick(TAGS)))];
    // "fraud" and "risk" always travel together, so they fold into one theme.
    if (tags.includes("fraud") || tags.includes("risk"))
      tags.splice(0, tags.length, ...new Set([...tags, "fraud", "risk"]));
    return {
      id: uuid("c", n),
      title: `Initiative ${n}`,
      teamId: pick(teams).id,
      status: pick(STATUSES),
      tier: r() < 0.4 ? "strategic" : "tactical",
      tags,
      contactPerson: pick(users).id,
      createdAt,
      updatedAt: r() < 0.2 ? createdAt : when(0, createdAt),
      mergedIntoId: null,
    };
  });
  for (const i of initiatives.slice(0, 4)) {
    i.mergedIntoId = initiatives[10]!.id;
    i.status = "cancelled";
  }

  const edges: Data["edges"] = [];
  for (let n = 0; n < 30; n++) {
    const from = pick(initiatives);
    const to = pick(initiatives);
    if (from === to) continue;
    edges.push({
      from: from.id,
      to: to.id,
      type: r() < 0.7 ? "builds_on" : pick(["replaces", "related"] as const),
      createdAt: when(300),
    });
  }

  const overlaps: Data["overlaps"] = [];
  for (let n = 0; n < 12; n++) {
    const [x, y] = [pick(initiatives).id, pick(initiatives).id].sort();
    if (x === y || overlaps.some((o) => o.initiativeAId === x && o.initiativeBId === y)) continue;
    const createdAt = when(200);
    overlaps.push({
      id: uuid("d", n),
      initiativeAId: x!,
      initiativeBId: y!,
      score: 0.8 + r() * 0.19,
      status: pick(["open", "open", "merged", "linked", "dismissed"] as const),
      createdAt,
      updatedAt: when(0, createdAt),
    });
  }

  const signals: Data["signals"] = Array.from({ length: 28 }, () => {
    const createdAt = when(400);
    return {
      initiativeId: pick(initiatives).id,
      teamId: pick(teams).id,
      note: r() < 0.8 ? "We need it" : null,
      createdAt,
      confirmedAt: r() < 0.5 ? createdAt : when(0, createdAt),
    };
  });

  const activity: Data["activity"] = [];
  for (let n = 0; n < 60; n++) {
    const i = pick(initiatives);
    const to = r() < 0.4 ? i.status : pick(STATUSES);
    activity.push({
      id: uuid("e", n),
      initiativeId: i.id,
      data: r() < 0.15 ? { to } : { from: pick(STATUSES), to },
      createdAt: when(200),
    });
  }
  return { teams, users, initiatives, edges, overlaps, signals, activity };
}

// --------------------------------------------- the old algorithm, verbatim

const STALE_AFTER_DAYS = 45;
const OPEN: InitiativeStatus[] = ["idea", "planned", "in_progress", "on_hold"];
const STAGE: Partial<Record<InitiativeStatus, number>> = {
  idea: 0,
  on_hold: 1,
  planned: 1,
  in_progress: 2,
  shipped: 3,
};
const emptyStatus = (): Record<InitiativeStatus, number> => ({
  idea: 0,
  planned: 0,
  in_progress: 0,
  on_hold: 0,
  shipped: 0,
  cancelled: 0,
});
type Row = Data["initiatives"][number];

function legacyBrief(
  data: Data,
  opts: { days: number | null; orgUnit: string | null },
  now: number,
): PortfolioBrief {
  const since = opts.days ? new Date(now - opts.days * DAY) : null;
  const previousSince = opts.days ? new Date(now - 2 * opts.days * DAY) : null;
  const staleDemandBefore = now - DEMAND_STALE_AFTER_DAYS * DAY;

  const allTeams = data.teams.filter((t) => t.status === "active");
  const people = data.users;
  const rows = data.initiatives.filter((i) => i.mergedIntoId === null);
  const mergedRows = data.initiatives.filter((i) => i.mergedIntoId !== null);
  const edgeRows = data.edges;
  const overlapRows = data.overlaps;
  const signalRows = data.signals;
  const statusRows = [...data.activity];

  const orgUnits = [...new Set(allTeams.map((t) => t.orgUnit).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b),
  );
  const scopedTeams = opts.orgUnit ? allTeams.filter((t) => t.orgUnit === opts.orgUnit) : allTeams;
  const inScope = new Set(scopedTeams.map((t) => t.id));
  const personName = new Map(people.map((p) => [p.id, p.name]));

  const byId = new Map(rows.map((r) => [r.id, r as Row]));
  const live = (r: Row) => r.status !== "cancelled";
  const open = (r: Row) => OPEN.includes(r.status);
  const scoped = rows.filter((r) => inScope.has(r.teamId) && live(r)) as Row[];
  const inPeriod = (d: Date) => !since || d >= since;
  const ref = (r: Row): BriefInitiativeRef => ({
    id: r.id,
    title: r.title,
    teamId: r.teamId,
    status: r.status,
    tier: r.tier,
    contactName: personName.get(r.contactPerson) ?? null,
  });
  const goneQuiet = (r: Row) =>
    (r.status === "planned" || r.status === "in_progress") &&
    now - r.updatedAt.getTime() > STALE_AFTER_DAYS * DAY;

  const shippedAt = new Map<string, Date>();
  const lastMove = new Map<string, { from: InitiativeStatus; to: InitiativeStatus; at: Date }>();
  for (const s of statusRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const { from, to } = s.data as { from?: InitiativeStatus; to?: InitiativeStatus };
    if (to === "shipped") shippedAt.set(s.initiativeId, s.createdAt);
    if (from && to && inPeriod(s.createdAt))
      lastMove.set(s.initiativeId, { from, to, at: s.createdAt });
  }
  const shippedInPeriod = (r: Row) =>
    r.status === "shipped" && (!since || (shippedAt.get(r.id) ?? r.updatedAt) >= since);

  const wantsOf = new Map<string, BriefWant[]>();
  const addWant = (initiativeId: string, want: BriefWant) => {
    if (!wantsOf.has(initiativeId)) wantsOf.set(initiativeId, []);
    wantsOf.get(initiativeId)!.push(want);
  };
  for (const s of signalRows) {
    const target = byId.get(s.initiativeId);
    if (!target || s.teamId === target.teamId) continue;
    addWant(s.initiativeId, {
      teamId: s.teamId,
      how: "asked",
      reason: s.note,
      at: s.confirmedAt.toISOString(),
      stale: s.confirmedAt.getTime() < staleDemandBefore,
    });
  }
  const builderTeams = new Map<string, Set<string>>();
  for (const e of edgeRows) {
    if (e.type !== "builds_on") continue;
    const builder = byId.get(e.from);
    const provider = byId.get(e.to);
    if (!builder || !provider || builder.teamId === provider.teamId) continue;
    if (!open(builder)) continue;
    addWant(provider.id, {
      teamId: builder.teamId,
      how: "builds_on",
      reason: builder.title,
      via: ref(builder),
      at: e.createdAt.toISOString(),
      stale: false,
    });
    if (!builderTeams.has(provider.id)) builderTeams.set(provider.id, new Set());
    builderTeams.get(provider.id)!.add(builder.teamId);
  }
  const freshTeams = (wants: BriefWant[]) =>
    new Set(wants.filter((w) => !w.stale).map((w) => w.teamId));

  const wanted: BriefWanted[] = scoped
    .filter((r) => r.status !== "shipped" && wantsOf.has(r.id))
    .map((r) => {
      const wants = [...wantsOf.get(r.id)!].sort(
        (a, b) => Number(a.stale) - Number(b.stale) || b.at.localeCompare(a.at),
      );
      return {
        initiative: ref(r),
        teams: freshTeams(wants).size,
        wants,
        uncommitted: r.status === "idea" || r.status === "on_hold",
      };
    })
    .sort(
      (a, b) =>
        b.teams - a.teams ||
        Number(b.uncommitted) - Number(a.uncommitted) ||
        (b.wants[0]?.at ?? "").localeCompare(a.wants[0]?.at ?? ""),
    );

  const overlapList: BriefOverlap[] = overlapRows
    .filter((o) => o.status === "open")
    .map((o) => ({ o, a: byId.get(o.initiativeAId), b: byId.get(o.initiativeBId) }))
    .filter(
      ({ a, b }) =>
        a && b && live(a) && live(b) && (inScope.has(a.teamId) || inScope.has(b.teamId)),
    )
    .map(({ o, a, b }) => {
      const [first, second] = a!.createdAt >= b!.createdAt ? [a!, b!] : [b!, a!];
      return {
        id: o.id,
        score: o.score,
        a: ref(first),
        b: ref(second),
        detectedAt: o.createdAt.toISOString(),
      };
    })
    .sort((x, y) => y.score - x.score);

  const stale: BriefStale[] = scoped
    .filter(goneQuiet)
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((r) => ({ initiative: ref(r), updatedAt: r.updatedAt.toISOString() }));

  const scored: { score: number; item: BriefDecision }[] = [];
  for (const o of overlapList) {
    scored.push({
      score: 100 + o.score * 20,
      item: {
        kind: "duplicate",
        initiative: o.a,
        other: o.b,
        teamIds: [o.b.teamId],
        value: Math.round(o.score * 100),
      },
    });
  }
  for (const w of wanted) {
    if (!w.uncommitted || w.teams < 2) continue;
    scored.push({
      score: 80 + w.teams * 10,
      item: {
        kind: "uncommitted_demand",
        initiative: w.initiative,
        teamIds: [...freshTeams(w.wants)],
        value: w.teams,
      },
    });
  }
  for (const r of scoped) {
    const builders = [...(builderTeams.get(r.id) ?? [])];
    const quiet = goneQuiet(r);
    if (builders.length && (r.status === "on_hold" || quiet)) {
      scored.push({
        score: 60 + builders.length * 10,
        item: { kind: "at_risk", initiative: ref(r), teamIds: builders, value: builders.length },
      });
    } else if (quiet && r.tier === "strategic") {
      const days = Math.floor((now - r.updatedAt.getTime()) / DAY);
      scored.push({
        score: 20 + Math.min(days, 365) / 10,
        item: { kind: "gone_quiet", initiative: ref(r), teamIds: [], value: days },
      });
    }
  }
  const decisions = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.item);

  const recent = scoped.filter((r) => open(r) && inPeriod(r.createdAt));
  const themeMap = new Map<string, Row[]>();
  for (const r of recent) {
    for (const tag of new Set(r.tags.map((t) => t.toLowerCase()))) {
      if (!themeMap.has(tag)) themeMap.set(tag, []);
      themeMap.get(tag)!.push(r);
    }
  }
  const folded = new Map<string, { tags: string[]; list: Row[] }>();
  for (const [tag, list] of [...themeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = list
      .map((r) => r.id)
      .sort()
      .join(",");
    const hit = folded.get(key);
    if (hit) hit.tags.push(tag);
    else folded.set(key, { tags: [tag], list });
  }
  const emerging: BriefEmerging[] = [...folded.values()]
    .map(({ tags: [tag, ...related], list }): BriefEmerging => {
      const teamIds = [...new Set(list.map((r) => r.teamId))];
      const theme: BriefTheme = {
        tag: tag!,
        related,
        count: list.length,
        newInPeriod: list.length,
        teamIds,
        initiatives: [...list]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 5)
          .map(ref),
      };
      return { ...theme, separate: teamIds.length >= 2 };
    })
    .filter((t) => t.count >= 2)
    .filter(
      (t, _, all) =>
        !all.some(
          (o) =>
            o !== t &&
            o.count > t.count &&
            t.initiatives.every((r) => o.initiatives.some((x) => x.id === r.id)),
        ),
    )
    .sort(
      (a, b) =>
        Number(b.separate) - Number(a.separate) ||
        b.teamIds.length - a.teamIds.length ||
        b.count - a.count,
    )
    .slice(0, 6);

  const changes: BriefChange[] = [];
  if (since) {
    const merged = new Map(mergedRows.map((r) => [r.id, r as Row]));
    for (const o of overlapRows) {
      if (o.status === "open" || o.updatedAt < since) continue;
      const a = byId.get(o.initiativeAId) ?? merged.get(o.initiativeAId) ?? null;
      const b = byId.get(o.initiativeBId) ?? merged.get(o.initiativeBId) ?? null;
      const [first, second] =
        o.status === "merged" && b && merged.has(b.id) ? [b, a] : a ? [a, b] : [b, a];
      if (!first || !(inScope.has(first.teamId) || (second && inScope.has(second.teamId))))
        continue;
      changes.push({
        kind: o.status as "merged" | "linked" | "dismissed",
        initiative: ref(first),
        ...(second && { other: ref(second) }),
        at: o.updatedAt.toISOString(),
      });
    }
    for (const [id, move] of lastMove) {
      const r = byId.get(id);
      if (!r || !inScope.has(r.teamId) || r.status !== move.to) continue;
      if (move.to === "shipped") {
        changes.push({ kind: "shipped", initiative: ref(r), at: move.at.toISOString() });
      } else if ((STAGE[move.to] ?? -1) > (STAGE[move.from] ?? 99) && move.to !== "on_hold") {
        changes.push({
          kind: "moved",
          initiative: ref(r),
          from: move.from,
          at: move.at.toISOString(),
        });
      }
    }
    for (const r of scoped) {
      const firstSign = new Map<string, Date>();
      for (const w of wantsOf.get(r.id) ?? []) {
        const at =
          w.how === "asked"
            ? signalRows.find((s) => s.initiativeId === r.id && s.teamId === w.teamId)?.createdAt
            : new Date(w.at);
        if (!at) continue;
        const prev = firstSign.get(w.teamId);
        if (!prev || at < prev) firstSign.set(w.teamId, at);
      }
      for (const [teamId, at] of firstSign) {
        if (at < since) continue;
        changes.push({ kind: "wanted", initiative: ref(r), teamId, at: at.toISOString() });
      }
    }
    changes.sort((a, b) => b.at.localeCompare(a.at));
  }

  const teamRows: BriefTeamRow[] = scopedTeams
    .map((t) => {
      const mine = scoped.filter((r) => r.teamId === t.id);
      const byStatus = emptyStatus();
      for (const r of mine) byStatus[r.status]++;
      const demanding = new Set<string>();
      for (const r of mine) {
        if (r.status === "shipped") continue;
        for (const team of freshTeams(wantsOf.get(r.id) ?? [])) demanding.add(team);
      }
      const updated = mine.reduce<Date | null>(
        (max, r) => (!max || r.updatedAt > max ? r.updatedAt : max),
        null,
      );
      return {
        teamId: t.id,
        name: t.name,
        orgUnit: t.orgUnit,
        total: mine.length,
        byStatus,
        newInPeriod: mine.filter((r) => inPeriod(r.createdAt)).length,
        shippedInPeriod: mine.filter(shippedInPeriod).length,
        demandTeams: demanding.size,
        openOverlaps: overlapList.filter((o) => o.a.teamId === t.id || o.b.teamId === t.id).length,
        lastActivityAt: updated?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const totalsByStatus = emptyStatus();
  for (const r of scoped) totalsByStatus[r.status]++;

  const brief: PortfolioBrief = {
    generatedAt: new Date(now).toISOString(),
    days: opts.days,
    since: since?.toISOString() ?? null,
    orgUnit: opts.orgUnit,
    orgUnits,
    summary: [],
    totals: {
      live: scoped.length,
      byStatus: totalsByStatus,
      strategic: scoped.filter((r) => r.tier === "strategic").length,
      newInPeriod: scoped.filter((r) => inPeriod(r.createdAt)).length,
      newPreviousPeriod: since
        ? scoped.filter((r) => r.createdAt >= previousSince! && r.createdAt < since).length
        : null,
      shippedInPeriod: scoped.filter(shippedInPeriod).length,
      openOverlaps: overlapList.length,
      goneQuiet: stale.length,
    },
    decisions,
    emerging,
    newest: scoped
      .filter((r) => inPeriod(r.createdAt))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8)
      .map((r) => ({ ...ref(r), createdAt: r.createdAt.toISOString() })),
    wanted: wanted.slice(0, 8),
    changes: changes.slice(0, 12),
    teams: teamRows,
    overlaps: overlapList,
    stale: stale.slice(0, 8),
  };
  const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
  brief.summary = briefSummary(brief, (id) => teamName.get(id) ?? "another team");
  return brief;
}

// ------------------------------- each SQL query, answered over the arrays

const by =
  <T>(...keys: ((x: T) => number | string)[]) =>
  (a: T, b: T) => {
    for (const k of keys) {
      const x = k(a);
      const y = k(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
const t = (d: Date) => d.getTime();
const OPEN_SET = new Set<string>(OPEN);

class MemorySource implements BriefSource {
  private readonly byId: Map<string, Row>;
  constructor(private readonly d: Data) {
    this.byId = new Map(d.initiatives.map((i) => [i.id, i]));
  }

  private ref(i: Row): BriefInitiativeRef {
    return {
      id: i.id,
      title: i.title,
      teamId: i.teamId,
      status: i.status,
      tier: i.tier,
      contactName: this.d.users.find((u) => u.id === i.contactPerson)?.name ?? null,
    };
  }
  private live(i: Row, q: BriefQuery) {
    return !i.mergedIntoId && i.status !== "cancelled" && q.scope.includes(i.teamId);
  }
  private inPeriod(d: Date, q: BriefQuery) {
    return !q.since || d >= q.since;
  }
  private quiet(i: Row, q: BriefQuery) {
    return (i.status === "planned" || i.status === "in_progress") && i.updatedAt < q.quietBefore;
  }
  /** The `buildsOn` SQL fragment: [edge, builder, provider]. */
  private buildsOn() {
    return this.d.edges.flatMap((e) => {
      const b = this.byId.get(e.from);
      const p = this.byId.get(e.to);
      return e.type === "builds_on" &&
        b &&
        p &&
        !b.mergedIntoId &&
        !p.mergedIntoId &&
        b.teamId !== p.teamId &&
        OPEN_SET.has(b.status)
        ? [{ e, b, p }]
        : [];
    });
  }
  /** The `asked` SQL fragment. */
  private asked() {
    return this.d.signals.filter((s) => {
      const target = this.byId.get(s.initiativeId);
      return target && !target.mergedIntoId && s.teamId !== target.teamId;
    });
  }
  private demandPerTeam(q: BriefQuery) {
    const w = [
      ...this.asked().map((s) => ({
        initiativeId: s.initiativeId,
        teamId: s.teamId,
        at: s.confirmedAt,
        stale: s.confirmedAt < q.staleDemandBefore,
      })),
      ...this.buildsOn().map(({ e, b }) => ({
        initiativeId: e.to,
        teamId: b.teamId,
        at: e.createdAt,
        stale: false,
      })),
    ];
    const groups = new Map<
      string,
      { initiativeId: string; teamId: string; fresh: Date | null; any: Date }
    >();
    for (const x of w) {
      const key = `${x.initiativeId}|${x.teamId}`;
      const g = groups.get(key) ?? {
        initiativeId: x.initiativeId,
        teamId: x.teamId,
        fresh: null,
        any: x.at,
      };
      if (x.at > g.any) g.any = x.at;
      if (!x.stale && (!g.fresh || x.at > g.fresh)) g.fresh = x.at;
      groups.set(key, g);
    }
    return [...groups.values()];
  }

  async activeTeams() {
    return this.d.teams
      .filter((x) => x.status === "active")
      .map((x) => ({ id: x.id, name: x.name, orgUnit: x.orgUnit }));
  }

  async counts(q: BriefQuery) {
    const shippedEvents = this.d.activity.filter((a) => a.data.to === "shipped");
    const groups = new Map<string, Awaited<ReturnType<BriefSource["counts"]>>[number]>();
    for (const i of this.d.initiatives.filter((x) => this.live(x, q))) {
      const key = `${i.teamId}|${i.status}`;
      const g = groups.get(key) ?? {
        teamId: i.teamId,
        status: i.status,
        n: 0,
        strategic: 0,
        newInPeriod: 0,
        newPreviousPeriod: 0,
        shippedInPeriod: 0,
        goneQuiet: 0,
        lastUpdated: null,
      };
      const mine = shippedEvents.filter((a) => a.initiativeId === i.id);
      const shipped =
        i.status === "shipped" &&
        (!q.since ||
          mine.some((a) => a.createdAt >= q.since!) ||
          (i.updatedAt >= q.since && mine.length === 0));
      g.n++;
      if (i.tier === "strategic") g.strategic++;
      if (this.inPeriod(i.createdAt, q)) g.newInPeriod++;
      if (q.since && q.previousSince && i.createdAt >= q.previousSince && i.createdAt < q.since)
        g.newPreviousPeriod++;
      if (shipped) g.shippedInPeriod++;
      if (this.quiet(i, q)) g.goneQuiet++;
      if (!g.lastUpdated || i.updatedAt > g.lastUpdated) g.lastUpdated = i.updatedAt;
      groups.set(key, g);
    }
    return [...groups.values()];
  }

  async goneQuiet(q: BriefQuery, limit: number): Promise<Dated[]> {
    return this.d.initiatives
      .filter((i) => this.live(i, q) && this.quiet(i, q))
      .sort(
        by(
          (i) => t(i.updatedAt),
          (i) => i.id,
        ),
      )
      .slice(0, limit)
      .map((i) => ({ initiative: this.ref(i), at: i.updatedAt }));
  }

  async newest(q: BriefQuery, limit: number): Promise<Dated[]> {
    return this.d.initiatives
      .filter((i) => this.live(i, q) && this.inPeriod(i.createdAt, q))
      .sort(
        by(
          (i) => -t(i.createdAt),
          (i) => i.id,
        ),
      )
      .slice(0, limit)
      .map((i) => ({ initiative: this.ref(i), at: i.createdAt }));
  }

  async openOverlaps(q: BriefQuery, limit: number) {
    const open = this.d.overlaps.flatMap((o) => {
      const a = this.byId.get(o.initiativeAId)!;
      const b = this.byId.get(o.initiativeBId)!;
      return o.status === "open" &&
        !a.mergedIntoId &&
        !b.mergedIntoId &&
        a.status !== "cancelled" &&
        b.status !== "cancelled" &&
        (q.scope.includes(a.teamId) || q.scope.includes(b.teamId))
        ? [{ o, a, b }]
        : [];
    });
    const perTeam = new Map<string, number>();
    for (const { a, b } of open)
      for (const team of new Set([a.teamId, b.teamId]))
        perTeam.set(team, (perTeam.get(team) ?? 0) + 1);
    return {
      total: open.length,
      perTeam: [...perTeam].map(([teamId, n]) => ({ teamId, n })),
      top: open
        .sort(
          by(
            (x) => -x.o.score,
            (x) => x.o.id,
          ),
        )
        .slice(0, limit)
        .map(({ o, a, b }) => ({
          id: o.id,
          score: o.score,
          detectedAt: o.createdAt,
          a: this.ref(a),
          aCreatedAt: a.createdAt,
          b: this.ref(b),
          bCreatedAt: b.createdAt,
        })),
    };
  }

  async demand(q: BriefQuery, limits: { wanted: number; decisions: number }) {
    const perTeam = this.demandPerTeam(q);
    const perInitiative = new Map<string, typeof perTeam>();
    for (const g of perTeam) {
      if (!perInitiative.has(g.initiativeId)) perInitiative.set(g.initiativeId, []);
      perInitiative.get(g.initiativeId)!.push(g);
    }
    const rows = [...perInitiative].flatMap(([id, gs]) => {
      const i = this.byId.get(id)!;
      if (!this.live(i, q) || i.status === "shipped") return [];
      const fresh = gs.filter((g) => g.fresh).sort(by((g) => -t(g.fresh!)));
      const topAt = fresh.length
        ? fresh[0]!.fresh!
        : gs.map((g) => g.any).sort(by((d) => -t(d)))[0]!;
      return [
        {
          i,
          teams: fresh.length,
          freshTeamIds: fresh.map((g) => g.teamId),
          uncommitted: i.status === "idea" || i.status === "on_hold",
          topAt,
        },
      ];
    });
    type R = (typeof rows)[number];
    const wanted = [...rows].sort(
      by<R>(
        (r) => -r.teams,
        (r) => -Number(r.uncommitted),
        (r) => -t(r.topAt),
        (r) => r.i.id,
      ),
    );
    const decisions = rows
      .filter((r) => r.uncommitted && r.teams >= 2)
      .sort(
        by<R>(
          (r) => -r.teams,
          (r) => -t(r.topAt),
          (r) => r.i.id,
        ),
      )
      .slice(0, limits.decisions);
    const top = new Set(wanted.slice(0, limits.wanted));
    const demandTeams = new Map<string, Set<string>>();
    for (const g of perTeam) {
      const i = this.byId.get(g.initiativeId)!;
      if (!g.fresh || !this.live(i, q) || i.status === "shipped") continue;
      if (!demandTeams.has(i.teamId)) demandTeams.set(i.teamId, new Set());
      demandTeams.get(i.teamId)!.add(g.teamId);
    }
    return {
      rows: wanted
        .filter((r) => top.has(r) || decisions.includes(r))
        .map((r) => ({
          initiative: this.ref(r.i),
          teams: r.teams,
          freshTeamIds: r.freshTeamIds,
          uncommitted: r.uncommitted,
          inWanted: top.has(r),
          inDecisions: decisions.includes(r),
        })),
      perTeam: [...demandTeams].map(([teamId, s]) => ({ teamId, n: s.size })),
    };
  }

  async wantsFor(q: BriefQuery, ids: string[]): Promise<BriefWantRow[]> {
    return [
      ...this.asked()
        .filter((s) => ids.includes(s.initiativeId))
        .map((s): BriefWantRow => ({
          initiativeId: s.initiativeId,
          teamId: s.teamId,
          how: "asked",
          reason: s.note,
          at: s.confirmedAt,
          stale: s.confirmedAt < q.staleDemandBefore,
        })),
      ...this.buildsOn()
        .filter(({ e }) => ids.includes(e.to))
        .map(({ e, b }): BriefWantRow => ({
          initiativeId: e.to,
          teamId: b.teamId,
          how: "builds_on",
          reason: b.title,
          via: this.ref(b),
          at: e.createdAt,
          stale: false,
        })),
    ];
  }

  async atRisk(q: BriefQuery, limit: number) {
    const builders = new Map<string, Map<string, Date>>();
    for (const { e, b, p } of this.buildsOn()) {
      if (!this.live(p, q) || !(p.status === "on_hold" || this.quiet(p, q))) continue;
      if (!builders.has(p.id)) builders.set(p.id, new Map());
      const m = builders.get(p.id)!;
      const prev = m.get(b.teamId);
      if (!prev || e.createdAt < prev) m.set(b.teamId, e.createdAt);
    }
    return [...builders]
      .map(([id, m]) => ({
        i: this.byId.get(id)!,
        teamIds: [...m]
          .sort(
            by(
              (x) => t(x[1]),
              (x) => x[0],
            ),
          )
          .map((x) => x[0]),
      }))
      .sort(
        by(
          (r) => -r.teamIds.length,
          (r) => t(r.i.updatedAt),
          (r) => r.i.id,
        ),
      )
      .slice(0, limit)
      .map((r) => ({ initiative: this.ref(r.i), updatedAt: r.i.updatedAt, teamIds: r.teamIds }));
  }

  async quietStrategic(q: BriefQuery, limit: number): Promise<Dated[]> {
    const built = new Set(this.buildsOn().map(({ p }) => p.id));
    return this.d.initiatives
      .filter(
        (i) => this.live(i, q) && i.tier === "strategic" && this.quiet(i, q) && !built.has(i.id),
      )
      .sort(
        by(
          (i) => t(i.updatedAt),
          (i) => i.id,
        ),
      )
      .slice(0, limit)
      .map((i) => ({ initiative: this.ref(i), at: i.updatedAt }));
  }

  private recent(q: BriefQuery) {
    return this.d.initiatives.filter(
      (i) => this.live(i, q) && OPEN_SET.has(i.status) && this.inPeriod(i.createdAt, q),
    );
  }

  async themes(q: BriefQuery, limit: number): Promise<BriefThemeRow[]> {
    const tagged = new Map<string, Row[]>();
    for (const i of this.recent(q))
      for (const tag of new Set(i.tags)) {
        if (!tagged.has(tag)) tagged.set(tag, []);
        tagged.get(tag)!.push(i);
      }
    return [...tagged]
      .filter(([, list]) => list.length >= 2)
      .map(([tag, list]) => {
        const latest = new Map<string, number>();
        for (const i of list)
          latest.set(i.teamId, Math.max(latest.get(i.teamId) ?? 0, t(i.createdAt)));
        return {
          tag,
          count: list.length,
          teamIds: [...latest]
            .sort(
              by(
                (x) => -x[1],
                (x) => x[0],
              ),
            )
            .map((x) => x[0]),
          key: list
            .map((i) => i.id)
            .sort()
            .join(","),
        };
      })
      .sort(
        by(
          (r) => -r.teamIds.length,
          (r) => -r.count,
          (r) => r.tag,
        ),
      )
      .slice(0, limit);
  }

  async themeInitiatives(q: BriefQuery, tags: string[], perTag: number) {
    const recent = this.recent(q);
    return tags.flatMap((tag) =>
      recent
        .filter((i) => i.tags.includes(tag))
        .sort(
          by(
            (i) => -t(i.createdAt),
            (i) => i.id,
          ),
        )
        .slice(0, perTag)
        .map((i) => ({ tag, initiative: this.ref(i), createdAt: i.createdAt })),
    );
  }

  async resolvedOverlaps(q: BriefQuery, limit: number) {
    return this.d.overlaps
      .filter((o) => o.status !== "open" && o.updatedAt >= q.since!)
      .map((o) => ({ o, a: this.byId.get(o.initiativeAId)!, b: this.byId.get(o.initiativeBId)! }))
      .filter(({ a, b }) => q.scope.includes(a.teamId) || q.scope.includes(b.teamId))
      .sort(
        by(
          (x) => -t(x.o.updatedAt),
          (x) => x.o.id,
        ),
      )
      .slice(0, limit)
      .map(({ o, a, b }) => ({
        status: o.status as "merged" | "linked" | "dismissed",
        at: o.updatedAt,
        a: this.ref(a),
        aMerged: !!a.mergedIntoId,
        b: this.ref(b),
        bMerged: !!b.mergedIntoId,
      }));
  }

  async moves(q: BriefQuery, limit: number) {
    const last = new Map<string, Data["activity"][number]>();
    for (const a of this.d.activity) {
      if (a.createdAt < q.since! || !a.data.from || !a.data.to) continue;
      const prev = last.get(a.initiativeId);
      if (!prev || a.createdAt > prev.createdAt) last.set(a.initiativeId, a);
    }
    return [...last.values()]
      .flatMap((a) => {
        const i = this.byId.get(a.initiativeId)!;
        return !i.mergedIntoId &&
          q.scope.includes(i.teamId) &&
          i.status === a.data.to &&
          classifyMove(a.data.from!, a.data.to!)
          ? [{ i, a }]
          : [];
      })
      .sort(
        by(
          (x) => -t(x.a.createdAt),
          (x) => x.i.id,
        ),
      )
      .slice(0, limit)
      .map(({ i, a }) => ({
        initiative: this.ref(i),
        from: a.data.from!,
        to: a.data.to!,
        at: a.createdAt,
      }));
  }

  async newlyWanted(q: BriefQuery, limit: number) {
    const first = new Map<string, { initiativeId: string; teamId: string; at: Date }>();
    const add = (initiativeId: string, teamId: string, at: Date) => {
      const key = `${initiativeId}|${teamId}`;
      const prev = first.get(key);
      if (!prev || at < prev.at) first.set(key, { initiativeId, teamId, at });
    };
    for (const s of this.asked()) add(s.initiativeId, s.teamId, s.createdAt);
    for (const { e, b } of this.buildsOn()) add(e.to, b.teamId, e.createdAt);
    return [...first.values()]
      .filter((f) => f.at >= q.since! && this.live(this.byId.get(f.initiativeId)!, q))
      .sort(
        by(
          (f) => -t(f.at),
          (f) => f.initiativeId,
        ),
      )
      .slice(0, limit)
      .map((f) => ({
        initiative: this.ref(this.byId.get(f.initiativeId)!),
        teamId: f.teamId,
        at: f.at,
      }));
  }
}

// ------------------------------------------------------------------ tests

/**
 * The old code broke ties by the order rows came out of the database; feed
 * it rows in the order the new queries break ties (and the one that the
 * real tables mostly come out in: oldest first).
 */
function asStored(d: Data): Data {
  return {
    ...d,
    initiatives: [...d.initiatives].sort(
      by(
        (i) => t(i.updatedAt),
        (i) => i.id,
      ),
    ),
    edges: [...d.edges].sort(by((e) => t(e.createdAt))),
    signals: [...d.signals].sort(by((s) => t(s.createdAt))),
  };
}

/** Which teams share a theme is a set; the old code listed them in storage order. */
const normalise = (b: PortfolioBrief) => ({
  ...b,
  emerging: b.emerging.map((e) => ({ ...e, teamIds: [...e.teamIds].sort() })),
});

describe("the brief, computed per section", () => {
  const periods = [null, 30, 90, 365];
  for (let seed = 1; seed <= 40; seed++) {
    it(`matches the old in-memory brief (dataset ${seed})`, async () => {
      const data = generate(seed);
      const units = [null, "Engineering", "Product", "Nowhere"];
      for (const days of periods) {
        for (const orgUnit of units) {
          const opts = { days, orgUnit };
          const expected = legacyBrief(asStored(data), opts, NOW);
          const actual = await computeBrief(new MemorySource(data), opts, NOW);
          expect(normalise(actual)).toEqual(normalise(expected));
        }
      }
    });
  }

  it("exercises every section on the generated data", async () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const b = await computeBrief(
        new MemorySource(generate(seed)),
        { days: 365, orgUnit: null },
        NOW,
      );
      for (const d of b.decisions) seen.add(`decision:${d.kind}`);
      for (const c of b.changes) seen.add(`change:${c.kind}`);
      if (b.emerging.some((e) => e.related.length)) seen.add("folded theme");
      if (b.wanted.some((w) => w.wants.some((x) => x.stale))) seen.add("stale want");
      if (b.totals.shippedInPeriod) seen.add("shipped");
    }
    expect([...seen].sort()).toEqual(
      [
        "change:dismissed",
        "change:linked",
        "change:merged",
        "change:moved",
        "change:shipped",
        "change:wanted",
        "decision:at_risk",
        "decision:duplicate",
        "decision:gone_quiet",
        "decision:uncommitted_demand",
        "folded theme",
        "shipped",
        "stale want",
      ].sort(),
    );
  });
});
