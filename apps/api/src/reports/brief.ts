import {
  DEMAND_STALE_AFTER_DAYS,
  type BriefChange,
  type BriefDecision,
  type BriefEmerging,
  type BriefOverlap,
  type BriefTeamRow,
  type BriefWant,
  type BriefWanted,
  type InitiativeStatus,
  type PortfolioBrief,
} from "@scry/shared";
import type {
  BriefCountRow,
  BriefDemandRow,
  BriefMoveRow,
  BriefNewlyWantedRow,
  BriefOverlapRow,
  BriefQuery,
  BriefResolvedOverlapRow,
  BriefRiskRow,
  BriefSource,
  BriefTeam,
  BriefThemeInitiative,
  BriefThemeRow,
  BriefWantRow,
  Dated,
} from "./brief-source";
import { briefSummary } from "./summary";

export const DAY = 86_400_000;
/** Planned or in-progress work untouched this long is reported as gone quiet. */
export const STALE_AFTER_DAYS = 45;

/** How many rows each section shows (or considers, for the ranked ones). */
export const BRIEF_LIMITS = {
  decisions: 5,
  newest: 8,
  wanted: 8,
  changes: 12,
  stale: 8,
  /** The brief lists the strongest; the total is in `totals.openOverlaps`. */
  overlaps: 20,
  themes: 6,
  /** Tags ranked before folding; far more than ever make the list. */
  themeCandidates: 200,
  themeInitiatives: 5,
} as const;

/** How far along each status is, to tell "moved forward" from a step back. */
const STAGE: Partial<Record<InitiativeStatus, number>> = {
  idea: 0,
  on_hold: 1,
  planned: 1,
  in_progress: 2,
  shipped: 3,
};

export const emptyStatus = (): Record<InitiativeStatus, number> => ({
  idea: 0,
  planned: 0,
  in_progress: 0,
  on_hold: 0,
  shipped: 0,
  cancelled: 0,
});

/** The last move in the period, as news: shipped, a step forward, or nothing to report. */
export function classifyMove(from: InitiativeStatus, to: InitiativeStatus) {
  if (to === "shipped") return "shipped" as const;
  if ((STAGE[to] ?? -1) > (STAGE[from] ?? 99) && to !== "on_hold") return "moved" as const;
  return null;
}

/** Fresh wants first, then most recent. */
export function sortWants(wants: BriefWant[]): BriefWant[] {
  return [...wants].sort((a, b) => Number(a.stale) - Number(b.stale) || b.at.localeCompare(a.at));
}

export function toWant(w: BriefWantRow): BriefWant {
  return {
    teamId: w.teamId,
    how: w.how,
    reason: w.reason,
    ...(w.via && { via: w.via }),
    at: w.at.toISOString(),
    stale: w.stale,
  };
}

/** Newest first: it's usually the one that duplicates existing work. */
export function toOverlap(o: BriefOverlapRow): BriefOverlap {
  const [first, second] = o.aCreatedAt >= o.bCreatedAt ? [o.a, o.b] : [o.b, o.a];
  return { id: o.id, score: o.score, a: first, b: second, detectedAt: o.detectedAt.toISOString() };
}

/**
 * Decisions: one ranked list, at most five, each naming who to talk to.
 * Each input is already the strongest few of its kind, in rank order, so
 * the top five overall are among them.
 */
export function rankDecisions(
  parts: {
    duplicates: BriefOverlap[];
    demand: BriefDemandRow[];
    risks: BriefRiskRow[];
    quiet: Dated[];
  },
  now: number,
): BriefDecision[] {
  const scored: { score: number; item: BriefDecision }[] = [];
  for (const o of parts.duplicates) {
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
  for (const w of parts.demand) {
    if (!w.uncommitted || w.teams < 2) continue;
    scored.push({
      score: 80 + w.teams * 10,
      item: {
        kind: "uncommitted_demand",
        initiative: w.initiative,
        teamIds: w.freshTeamIds,
        value: w.teams,
      },
    });
  }
  for (const r of parts.risks) {
    scored.push({
      score: 60 + r.teamIds.length * 10,
      item: {
        kind: "at_risk",
        initiative: r.initiative,
        teamIds: r.teamIds,
        value: r.teamIds.length,
      },
    });
  }
  for (const r of parts.quiet) {
    const days = Math.floor((now - r.at.getTime()) / DAY);
    scored.push({
      score: 20 + Math.min(days, 365) / 10,
      item: { kind: "gone_quiet", initiative: r.initiative, teamIds: [], value: days },
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, BRIEF_LIMITS.decisions)
    .map((s) => s.item);
}

/**
 * What's emerging: themes new work clusters around. Several teams on one
 * theme is the earliest sign of overlap, before any two items look alike.
 */
export function foldThemes(
  rows: BriefThemeRow[],
  initiatives: BriefThemeInitiative[],
): BriefEmerging[] {
  const newest = new Map<string, BriefThemeInitiative[]>();
  for (const i of initiatives) {
    if (!newest.has(i.tag)) newest.set(i.tag, []);
    newest.get(i.tag)!.push(i);
  }
  // Tags that always travel together ("fraud" and "risk" on the same
  // initiatives) are one theme, not two rows saying the same thing.
  const folded = new Map<string, { tags: string[]; row: BriefThemeRow }>();
  for (const row of [...rows].sort((a, b) => a.tag.localeCompare(b.tag))) {
    const hit = folded.get(row.key);
    if (hit) hit.tags.push(row.tag);
    else folded.set(row.key, { tags: [row.tag], row });
  }
  return (
    [...folded.values()]
      .map(({ tags: [tag, ...related], row }): BriefEmerging => {
        const list = [...(newest.get(tag!) ?? [])]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, BRIEF_LIMITS.themeInitiatives);
        return {
          tag: tag!,
          related,
          count: row.count,
          newInPeriod: row.count,
          teamIds: row.teamIds,
          initiatives: list.map((i) => i.initiative),
          separate: row.teamIds.length >= 2,
        };
      })
      .filter((t) => t.count >= 2)
      // A theme whose initiatives all carry a broader tag too adds nothing.
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
      .slice(0, BRIEF_LIMITS.themes)
  );
}

/** What changed in the period, latest first. */
export function mergeChanges(parts: {
  overlaps: BriefResolvedOverlapRow[];
  moves: BriefMoveRow[];
  wanted: BriefNewlyWantedRow[];
}): BriefChange[] {
  const changes: BriefChange[] = [];
  for (const o of parts.overlaps) {
    // For a merge, lead with the duplicate that was folded in.
    const [first, second] = o.status === "merged" && o.bMerged ? [o.b, o.a] : [o.a, o.b];
    changes.push({ kind: o.status, initiative: first, other: second, at: o.at.toISOString() });
  }
  for (const m of parts.moves) {
    const kind = classifyMove(m.from, m.to);
    if (kind === "shipped") {
      changes.push({ kind, initiative: m.initiative, at: m.at.toISOString() });
    } else if (kind === "moved") {
      changes.push({ kind, initiative: m.initiative, from: m.from, at: m.at.toISOString() });
    }
  }
  // One line per team that started wanting it (asking and building on it
  // are the same news), dated by the first sign.
  for (const w of parts.wanted) {
    changes.push({
      kind: "wanted",
      initiative: w.initiative,
      teamId: w.teamId,
      at: w.at.toISOString(),
    });
  }
  return changes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, BRIEF_LIMITS.changes);
}

/** Per-team rows and the totals, from the grouped counts. */
export function tally(
  teams: BriefTeam[],
  counts: BriefCountRow[],
  demandPerTeam: { teamId: string; n: number }[],
  overlapsPerTeam: { teamId: string; n: number }[],
) {
  const totals = {
    live: 0,
    byStatus: emptyStatus(),
    strategic: 0,
    newInPeriod: 0,
    newPreviousPeriod: 0,
    shippedInPeriod: 0,
    goneQuiet: 0,
  };
  const demand = new Map(demandPerTeam.map((d) => [d.teamId, d.n]));
  const overlaps = new Map(overlapsPerTeam.map((d) => [d.teamId, d.n]));
  const rows = new Map<string, BriefTeamRow>(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        name: t.name,
        orgUnit: t.orgUnit,
        total: 0,
        byStatus: emptyStatus(),
        newInPeriod: 0,
        shippedInPeriod: 0,
        demandTeams: demand.get(t.id) ?? 0,
        openOverlaps: overlaps.get(t.id) ?? 0,
        lastActivityAt: null,
      },
    ]),
  );
  for (const c of counts) {
    totals.live += c.n;
    totals.byStatus[c.status] += c.n;
    totals.strategic += c.strategic;
    totals.newInPeriod += c.newInPeriod;
    totals.newPreviousPeriod += c.newPreviousPeriod;
    totals.shippedInPeriod += c.shippedInPeriod;
    totals.goneQuiet += c.goneQuiet;
    const row = rows.get(c.teamId);
    if (!row) continue;
    row.total += c.n;
    row.byStatus[c.status] += c.n;
    row.newInPeriod += c.newInPeriod;
    row.shippedInPeriod += c.shippedInPeriod;
    const last = c.lastUpdated?.toISOString() ?? null;
    if (last && (!row.lastActivityAt || last > row.lastActivityAt)) row.lastActivityAt = last;
  }
  const teamRows = [...rows.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  return { totals, teamRows };
}

/**
 * The portfolio brief: a one-page read for leadership on what changed and
 * what needs a decision — duplicates, demand nobody has picked up, work many
 * teams build on that has stalled — rather than a delivery report. Every
 * figure (and the summary sentences) is computed here from the data; a model
 * may only reword the summary.
 */
export async function computeBrief(
  source: BriefSource,
  opts: { days: number | null; orgUnit: string | null },
  now: number,
): Promise<PortfolioBrief> {
  const since = opts.days ? new Date(now - opts.days * DAY) : null;
  const allTeams = await source.activeTeams();
  const orgUnits = [...new Set(allTeams.map((t) => t.orgUnit).filter(Boolean) as string[])].sort(
    (a, b) => a.localeCompare(b),
  );
  const scopedTeams = opts.orgUnit ? allTeams.filter((t) => t.orgUnit === opts.orgUnit) : allTeams;
  const q: BriefQuery = {
    scope: scopedTeams.map((t) => t.id),
    since,
    previousSince: opts.days ? new Date(now - 2 * opts.days * DAY) : null,
    quietBefore: new Date(now - STALE_AFTER_DAYS * DAY),
    staleDemandBefore: new Date(now - DEMAND_STALE_AFTER_DAYS * DAY),
  };
  const L = BRIEF_LIMITS;

  const [counts, stale, newest, overlaps, demand, risks, quiet, themes, changeParts] =
    await Promise.all([
      source.counts(q),
      source.goneQuiet(q, L.stale),
      source.newest(q, L.newest),
      source.openOverlaps(q, L.overlaps),
      source.demand(q, { wanted: L.wanted, decisions: L.decisions }),
      source.atRisk(q, L.decisions),
      source.quietStrategic(q, L.decisions),
      source.themes(q, L.themeCandidates),
      since
        ? Promise.all([
            source.resolvedOverlaps(q, L.changes),
            source.moves(q, L.changes),
            source.newlyWanted(q, L.changes),
          ])
        : null,
    ]);

  const wantedRows = demand.rows.filter((r) => r.inWanted);
  const [wants, themeInitiatives] = await Promise.all([
    wantedRows.length
      ? source.wantsFor(
          q,
          wantedRows.map((r) => r.initiative.id),
        )
      : [],
    themes.length
      ? source.themeInitiatives(
          q,
          themes.map((t) => t.tag),
          L.themeInitiatives,
        )
      : [],
  ]);

  const wantsOf = new Map<string, BriefWant[]>();
  for (const w of wants) {
    if (!wantsOf.has(w.initiativeId)) wantsOf.set(w.initiativeId, []);
    wantsOf.get(w.initiativeId)!.push(toWant(w));
  }
  const wanted: BriefWanted[] = wantedRows.map((r) => ({
    initiative: r.initiative,
    teams: r.teams,
    wants: sortWants(wantsOf.get(r.initiative.id) ?? []),
    uncommitted: r.uncommitted,
  }));

  const overlapList = overlaps.top.map(toOverlap);
  const { totals, teamRows } = tally(scopedTeams, counts, demand.perTeam, overlaps.perTeam);

  const brief: PortfolioBrief = {
    generatedAt: new Date(now).toISOString(),
    days: opts.days,
    since: since?.toISOString() ?? null,
    orgUnit: opts.orgUnit,
    orgUnits,
    summary: [],
    totals: {
      ...totals,
      newPreviousPeriod: since ? totals.newPreviousPeriod : null,
      openOverlaps: overlaps.total,
    },
    decisions: rankDecisions(
      {
        duplicates: overlapList,
        demand: demand.rows.filter((r) => r.inDecisions),
        risks,
        quiet,
      },
      now,
    ),
    emerging: foldThemes(themes, themeInitiatives),
    newest: newest.map((n) => ({ ...n.initiative, createdAt: n.at.toISOString() })),
    wanted,
    changes: changeParts
      ? mergeChanges({
          overlaps: changeParts[0],
          moves: changeParts[1],
          wanted: changeParts[2],
        })
      : [],
    teams: teamRows,
    overlaps: overlapList,
    stale: stale.map((s) => ({ initiative: s.initiative, updatedAt: s.at.toISOString() })),
  };
  const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
  brief.summary = briefSummary(brief, (id) => teamName.get(id) ?? "another team");
  return brief;
}
