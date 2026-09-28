import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@scry/db";
import type { BriefInitiativeRef, InitiativeStatus } from "@scry/shared";
import type {
  BriefCountRow,
  BriefDemand,
  BriefMoveRow,
  BriefNewlyWantedRow,
  BriefOpenOverlaps,
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

type Row = Record<string, unknown>;

// Aliases are fixed identifiers written here, never user input.
const raw = (s: string) => sql.raw(s);

/** A uuid[] parameter (uuids need no quoting inside an array literal). */
const uuids = (ids: string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
/** Timestamps come back as epoch milliseconds: no driver date parsing to trip over. */
const ms = (col: string) => raw(`floor(extract(epoch from ${col}) * 1000)::float8`);
const date = (v: unknown) => new Date(Number(v));

const OPEN = raw(`('idea', 'planned', 'in_progress', 'on_hold')`);
const QUIET_STATUSES = raw(`('planned', 'in_progress')`);

/** Counted in the brief: not merged away, not cancelled, owned by a team in scope. */
const live = (i: string, q: BriefQuery) =>
  sql`${raw(i)}.merged_into_id is null and ${raw(i)}.status <> 'cancelled' and ${raw(i)}.team_id = any(${uuids(q.scope)})`;
const inPeriod = (col: string, q: BriefQuery) =>
  q.since ? sql`${raw(col)} >= ${ts(q.since)}` : sql`true`;
const goneQuiet = (i: string, q: BriefQuery) =>
  sql`${raw(i)}.status in ${QUIET_STATUSES} and ${raw(i)}.updated_at < ${ts(q.quietBefore)}`;

/** Enough of an initiative to name and link it, prefixed to keep joined sides apart. */
const ref = (i: string, p = "") =>
  raw(
    `${i}.id as ${p}id, ${i}.title as ${p}title, ${i}.team_id as ${p}team_id, ` +
      `${i}.status as ${p}status, ${i}.tier as ${p}tier, ` +
      `(select name from users where users.id = ${i}.contact_person) as ${p}contact_name`,
  );
const toRef = (r: Row, p = ""): BriefInitiativeRef => ({
  id: r[`${p}id`] as string,
  title: r[`${p}title`] as string,
  teamId: r[`${p}team_id`] as string,
  status: r[`${p}status`] as InitiativeStatus,
  tier: r[`${p}tier`] as BriefInitiativeRef["tier"],
  contactName: (r[`${p}contact_name`] as string | null) ?? null,
});

/**
 * Open work on another team that builds on the provider `p`. Merged
 * duplicates live on in their survivor; shipped or cancelled work no
 * longer needs what it built on.
 */
const buildsOn = raw(
  `edges e join initiatives b on b.id = e.from_initiative_id
     join initiatives p on p.id = e.to_initiative_id
   where e.type = 'builds_on' and b.merged_into_id is null and p.merged_into_id is null
     and b.team_id <> p.team_id and b.status in ('idea', 'planned', 'in_progress', 'on_hold')`,
);
/** "We need this too" from another team than the owner's. */
const asked = raw(
  `initiative_signals s join initiatives t on t.id = s.initiative_id
   where t.merged_into_id is null and s.team_id <> t.team_id`,
);

/**
 * Who wants what, one row per (initiative, team): the team's latest fresh
 * sign (null if it only has stale asks) and its latest sign of any kind.
 * One team counts once, however it wants it.
 */
const demandPerTeam = (q: BriefQuery) => sql`
  select initiative_id, team_id,
    max(at) filter (where not stale) as fresh_at,
    max(at) as any_at
  from (
    select s.initiative_id, s.team_id, s.confirmed_at as at,
      s.confirmed_at < ${ts(q.staleDemandBefore)} as stale
    from ${asked}
    union all
    select e.to_initiative_id, b.team_id, e.created_at, false from ${buildsOn}
  ) w
  group by initiative_id, team_id`;

/** The brief's queries, one per section; see BriefSource. */
export class SqlBriefSource implements BriefSource {
  constructor(private readonly db: Db) {}

  private async rows(query: SQL): Promise<Row[]> {
    return [...(await this.db.execute<Row>(query))];
  }

  async activeTeams(): Promise<BriefTeam[]> {
    const rows = await this.rows(
      sql`select id, name, org_unit from teams where status = 'active' order by name, id`,
    );
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      orgUnit: (r.org_unit as string | null) ?? null,
    }));
  }

  async counts(q: BriefQuery): Promise<BriefCountRow[]> {
    const shippedEvent = sql`a.kind = 'status_changed' and a.data->>'to' = 'shipped'`;
    // Shipped in the period: its (latest) "shipped" event is in the period,
    // or, with no such event on record, it was last updated in the period.
    const shipped = q.since
      ? sql`i.status = 'shipped' and (
          i.id in (select a.initiative_id from activity a
                   where ${shippedEvent} and a.created_at >= ${ts(q.since)})
          or (i.updated_at >= ${ts(q.since)} and not exists (
                select 1 from activity a where a.initiative_id = i.id and ${shippedEvent})))`
      : sql`i.status = 'shipped'`;
    const previous =
      q.since && q.previousSince
        ? sql`i.created_at >= ${ts(q.previousSince)} and i.created_at < ${ts(q.since)}`
        : sql`false`;
    const rows = await this.rows(sql`
      select i.team_id, i.status,
        count(*)::int as n,
        count(*) filter (where i.tier = 'strategic')::int as strategic,
        count(*) filter (where ${inPeriod("i.created_at", q)})::int as new_in_period,
        count(*) filter (where ${previous})::int as new_previous,
        count(*) filter (where ${shipped})::int as shipped_in_period,
        count(*) filter (where ${goneQuiet("i", q)})::int as gone_quiet,
        ${ms("max(i.updated_at)")} as last_updated
      from initiatives i
      where ${live("i", q)}
      group by i.team_id, i.status`);
    return rows.map((r) => ({
      teamId: r.team_id as string,
      status: r.status as InitiativeStatus,
      n: r.n as number,
      strategic: r.strategic as number,
      newInPeriod: r.new_in_period as number,
      newPreviousPeriod: r.new_previous as number,
      shippedInPeriod: r.shipped_in_period as number,
      goneQuiet: r.gone_quiet as number,
      lastUpdated: r.last_updated === null ? null : date(r.last_updated),
    }));
  }

  async goneQuiet(q: BriefQuery, limit: number): Promise<Dated[]> {
    const rows = await this.rows(sql`
      select ${ref("i")}, ${ms("i.updated_at")} as at
      from initiatives i
      where ${live("i", q)} and ${goneQuiet("i", q)}
      order by i.updated_at, i.id
      limit ${limit}`);
    return rows.map((r) => ({ initiative: toRef(r), at: date(r.at) }));
  }

  async newest(q: BriefQuery, limit: number): Promise<Dated[]> {
    const rows = await this.rows(sql`
      select ${ref("i")}, ${ms("i.created_at")} as at
      from initiatives i
      where ${live("i", q)} and ${inPeriod("i.created_at", q)}
      order by i.created_at desc, i.id
      limit ${limit}`);
    return rows.map((r) => ({ initiative: toRef(r), at: date(r.at) }));
  }

  async openOverlaps(q: BriefQuery, limit: number): Promise<BriefOpenOverlaps> {
    // Possible duplicates across teams, still open, touching the scope.
    const open = sql`
      from initiative_overlaps o
      join initiatives a on a.id = o.initiative_a_id
      join initiatives b on b.id = o.initiative_b_id
      where o.status = 'open'
        and a.merged_into_id is null and b.merged_into_id is null
        and a.status <> 'cancelled' and b.status <> 'cancelled'
        and (a.team_id = any(${uuids(q.scope)}) or b.team_id = any(${uuids(q.scope)}))`;
    const [counts, top] = await Promise.all([
      this.rows(sql`
        with o as (select o.id, a.team_id as a_team, b.team_id as b_team ${open})
        select null as team_id, count(*)::int as n from o
        union all
        select t.team_id, count(*)::int from o
          cross join lateral (select distinct unnest(array[o.a_team, o.b_team])) t(team_id)
          group by t.team_id`),
      this.rows(sql`
        select o.id as overlap_id, o.score, ${ms("o.created_at")} as detected_at,
          ${ref("a", "a_")}, ${ms("a.created_at")} as a_created_at,
          ${ref("b", "b_")}, ${ms("b.created_at")} as b_created_at
        ${open}
        order by o.score desc, o.id
        limit ${limit}`),
    ]);
    return {
      total: (counts.find((c) => c.team_id === null)?.n as number | undefined) ?? 0,
      perTeam: counts
        .filter((c) => c.team_id !== null)
        .map((c) => ({ teamId: c.team_id as string, n: c.n as number })),
      top: top.map((r) => ({
        id: r.overlap_id as string,
        score: Number(r.score),
        detectedAt: date(r.detected_at),
        a: toRef(r, "a_"),
        aCreatedAt: date(r.a_created_at),
        b: toRef(r, "b_"),
        bCreatedAt: date(r.b_created_at),
      })),
    };
  }

  async demand(q: BriefQuery, limits: { wanted: number; decisions: number }): Promise<BriefDemand> {
    const [rows, perTeam] = await Promise.all([
      this.rows(sql`
        with per_team as (${demandPerTeam(q)}),
        per_initiative as (
          select initiative_id,
            count(fresh_at)::int as teams,
            coalesce(max(fresh_at), max(any_at)) as top_at,
            coalesce(json_agg(team_id order by fresh_at desc) filter (where fresh_at is not null), '[]') as fresh_team_ids
          from per_team group by initiative_id
        ),
        ranked as (
          select d.*, i.id as iid, i.status in ('idea', 'on_hold') as uncommitted,
            row_number() over (
              order by d.teams desc, i.status in ('idea', 'on_hold') desc, d.top_at desc, i.id
            ) as wanted_rank,
            row_number() over (
              partition by i.status in ('idea', 'on_hold') and d.teams >= 2
              order by d.teams desc, d.top_at desc, i.id
            ) as decision_rank
          from per_initiative d join initiatives i on i.id = d.initiative_id
          where ${live("i", q)} and i.status <> 'shipped'
        )
        select ${ref("i")}, r.teams, r.fresh_team_ids, r.uncommitted,
          r.wanted_rank <= ${limits.wanted} as in_wanted,
          (r.uncommitted and r.teams >= 2 and r.decision_rank <= ${limits.decisions}) as in_decisions
        from ranked r join initiatives i on i.id = r.iid
        where r.wanted_rank <= ${limits.wanted}
          or (r.uncommitted and r.teams >= 2 and r.decision_rank <= ${limits.decisions})
        order by r.wanted_rank`),
      this.rows(sql`
        with per_team as (${demandPerTeam(q)})
        select i.team_id, count(distinct d.team_id)::int as n
        from per_team d join initiatives i on i.id = d.initiative_id
        where d.fresh_at is not null and ${live("i", q)} and i.status <> 'shipped'
        group by i.team_id`),
    ]);
    return {
      rows: rows.map((r) => ({
        initiative: toRef(r),
        teams: r.teams as number,
        freshTeamIds: r.fresh_team_ids as string[],
        uncommitted: r.uncommitted as boolean,
        inWanted: r.in_wanted as boolean,
        inDecisions: r.in_decisions as boolean,
      })),
      perTeam: perTeam.map((r) => ({ teamId: r.team_id as string, n: r.n as number })),
    };
  }

  async wantsFor(q: BriefQuery, initiativeIds: string[]): Promise<BriefWantRow[]> {
    const ids = uuids(initiativeIds);
    const [askedRows, builtRows] = await Promise.all([
      this.rows(sql`
        select s.initiative_id, s.team_id, s.note, ${ms("s.confirmed_at")} as at,
          s.confirmed_at < ${ts(q.staleDemandBefore)} as stale
        from ${asked} and s.initiative_id = any(${ids})`),
      this.rows(sql`
        select e.to_initiative_id as initiative_id, ${ms("e.created_at")} as at, ${ref("b", "b_")}
        from ${buildsOn} and e.to_initiative_id = any(${ids})`),
    ]);
    return [
      ...askedRows.map((r): BriefWantRow => ({
        initiativeId: r.initiative_id as string,
        teamId: r.team_id as string,
        how: "asked",
        reason: (r.note as string | null) ?? null,
        at: date(r.at),
        stale: r.stale as boolean,
      })),
      ...builtRows.map((r): BriefWantRow => {
        const via = toRef(r, "b_");
        return {
          initiativeId: r.initiative_id as string,
          teamId: via.teamId,
          how: "builds_on",
          reason: via.title,
          via,
          at: date(r.at),
          stale: false,
        };
      }),
    ];
  }

  async atRisk(q: BriefQuery, limit: number): Promise<BriefRiskRow[]> {
    const rows = await this.rows(sql`
      with builders as (
        select e.to_initiative_id as pid, b.team_id, min(e.created_at) as first_at
        from ${buildsOn}
          and ${live("p", q)} and (p.status = 'on_hold' or ${goneQuiet("p", q)})
        group by e.to_initiative_id, b.team_id
      ),
      ranked as (
        select pid, count(*)::int as n,
          json_agg(team_id order by first_at, team_id) as team_ids
        from builders group by pid
      )
      select ${ref("i")}, ${ms("i.updated_at")} as updated_at, r.team_ids
      from ranked r join initiatives i on i.id = r.pid
      order by r.n desc, i.updated_at, i.id
      limit ${limit}`);
    return rows.map((r) => ({
      initiative: toRef(r),
      updatedAt: date(r.updated_at),
      teamIds: r.team_ids as string[],
    }));
  }

  async quietStrategic(q: BriefQuery, limit: number): Promise<Dated[]> {
    const rows = await this.rows(sql`
      select ${ref("i")}, ${ms("i.updated_at")} as at
      from initiatives i
      where ${live("i", q)} and i.tier = 'strategic' and ${goneQuiet("i", q)}
        and not exists (select 1 from ${buildsOn} and p.id = i.id)
      order by i.updated_at, i.id
      limit ${limit}`);
    return rows.map((r) => ({ initiative: toRef(r), at: date(r.at) }));
  }

  async themes(q: BriefQuery, limit: number): Promise<BriefThemeRow[]> {
    // Tags are stored normalised (trimmed, lower case, no repeats), so
    // they're grouped as they are. Two tags carried by exactly the same
    // initiatives get the same key (count plus two hash sums of the ids),
    // which is how they fold into one theme.
    const rows = await this.rows(sql`
      with tagged as (
        select distinct t.tag, i.id, i.team_id, i.created_at
        from initiatives i cross join lateral unnest(i.tags) t(tag)
        where ${live("i", q)} and i.status in ${OPEN} and ${inPeriod("i.created_at", q)}
      ),
      per_team as (
        select tag, team_id, count(*) as n, max(created_at) as latest,
          sum(hashtextextended(id::text, 0)) as h0, sum(hashtextextended(id::text, 1)) as h1
        from tagged group by tag, team_id
      )
      select tag, sum(n)::int as n, count(*)::int as teams,
        json_agg(team_id order by latest desc, team_id) as team_ids,
        sum(n)::text || ':' || sum(h0)::text || ':' || sum(h1)::text as key
      from per_team
      group by tag
      having sum(n) >= 2
      order by count(*) desc, sum(n) desc, tag
      limit ${limit}`);
    return rows.map((r) => ({
      tag: r.tag as string,
      count: r.n as number,
      teamIds: r.team_ids as string[],
      key: r.key as string,
    }));
  }

  async themeInitiatives(
    q: BriefQuery,
    tags: string[],
    perTag: number,
  ): Promise<BriefThemeInitiative[]> {
    const rows = await this.rows(sql`
      select x.tag, n.*
      from jsonb_array_elements_text(${JSON.stringify(tags)}::jsonb) as x(tag)
      cross join lateral (
        select ${ref("i")}, ${ms("i.created_at")} as created_at
        from initiatives i
        where i.tags @> array[x.tag] and ${live("i", q)} and i.status in ${OPEN}
          and ${inPeriod("i.created_at", q)}
        order by i.created_at desc, i.id
        limit ${perTag}
      ) n`);
    return rows.map((r) => ({
      tag: r.tag as string,
      initiative: toRef(r),
      createdAt: date(r.created_at),
    }));
  }

  async resolvedOverlaps(q: BriefQuery, limit: number): Promise<BriefResolvedOverlapRow[]> {
    if (!q.since) return [];
    // Merged duplicates included: "what changed" names them when they were merged.
    const rows = await this.rows(sql`
      select o.status, ${ms("o.updated_at")} as at,
        ${ref("a", "a_")}, a.merged_into_id is not null as a_merged,
        ${ref("b", "b_")}, b.merged_into_id is not null as b_merged
      from initiative_overlaps o
      join initiatives a on a.id = o.initiative_a_id
      join initiatives b on b.id = o.initiative_b_id
      where o.status <> 'open' and o.updated_at >= ${ts(q.since)}
        and (a.team_id = any(${uuids(q.scope)}) or b.team_id = any(${uuids(q.scope)}))
      order by o.updated_at desc, o.id
      limit ${limit}`);
    return rows.map((r) => ({
      status: r.status as BriefResolvedOverlapRow["status"],
      at: date(r.at),
      a: toRef(r, "a_"),
      aMerged: r.a_merged as boolean,
      b: toRef(r, "b_"),
      bMerged: r.b_merged as boolean,
    }));
  }

  async moves(q: BriefQuery, limit: number): Promise<BriefMoveRow[]> {
    if (!q.since) return [];
    // Mirrors classifyMove(): shipped, or a step forward that isn't "on hold".
    const stage = (col: string, missing: number) =>
      raw(
        `coalesce(case ${col} when 'idea' then 0 when 'on_hold' then 1 when 'planned' then 1 ` +
          `when 'in_progress' then 2 when 'shipped' then 3 end, ${missing})`,
      );
    const rows = await this.rows(sql`
      with last_move as (
        select distinct on (a.initiative_id)
          a.initiative_id, a.data->>'from' as from_status, a.data->>'to' as to_status, a.created_at
        from activity a
        where a.kind = 'status_changed' and a.created_at >= ${ts(q.since)}
          and coalesce(a.data->>'from', '') <> '' and coalesce(a.data->>'to', '') <> ''
        order by a.initiative_id, a.created_at desc, a.id desc
      )
      select ${ref("i")}, m.from_status, m.to_status, ${ms("m.created_at")} as at
      from last_move m join initiatives i on i.id = m.initiative_id
      where i.merged_into_id is null and i.team_id = any(${uuids(q.scope)})
        and i.status::text = m.to_status
        and (m.to_status = 'shipped'
          or (${stage("m.to_status", -1)} > ${stage("m.from_status", 99)} and m.to_status <> 'on_hold'))
      order by m.created_at desc, i.id
      limit ${limit}`);
    return rows.map((r) => ({
      initiative: toRef(r),
      from: r.from_status as InitiativeStatus,
      to: r.to_status as InitiativeStatus,
      at: date(r.at),
    }));
  }

  async newlyWanted(q: BriefQuery, limit: number): Promise<BriefNewlyWantedRow[]> {
    if (!q.since) return [];
    const rows = await this.rows(sql`
      with first_sign as (
        select initiative_id, team_id, min(at) as at
        from (
          select s.initiative_id, s.team_id, s.created_at as at from ${asked}
          union all
          select e.to_initiative_id, b.team_id, e.created_at from ${buildsOn}
        ) w
        group by initiative_id, team_id
        having min(at) >= ${ts(q.since)}
      )
      select ${ref("i")}, f.team_id as wanting_team_id, ${ms("f.at")} as at
      from first_sign f join initiatives i on i.id = f.initiative_id
      where ${live("i", q)}
      order by f.at desc, i.id
      limit ${limit}`);
    return rows.map((r) => ({
      initiative: toRef(r),
      teamId: r.wanting_team_id as string,
      at: date(r.at),
    }));
  }
}
