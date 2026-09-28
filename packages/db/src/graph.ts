import { and, desc, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";
import { edges, initiatives, teams } from "./schema";

// Relationships live only in the `edges` table. They're few (human-entered,
// one per pair of teams' initiatives) and only ever walked a step or two, so
// a recursive CTE over the two endpoint indexes is all the "graph" needs.

export type EdgeType = (typeof edges.$inferSelect)["type"];
export const ALL_EDGE_TYPES: EdgeType[] = ["builds_on", "replaces", "related"];

/** Longer walks would lean on links nobody maintains; the UI offers 1 or 2. */
export const MAX_HOPS = 2;

export interface RelatedInitiative {
  id: string;
  /** Steps from `throughId`. */
  hops: number;
  /** The seed it was reached from: the first seed (in the order given) that reaches it. */
  throughId: string;
}

export function clampHops(hops: number): number {
  return Number.isFinite(hops) ? Math.max(1, Math.min(Math.trunc(hops), MAX_HOPS)) : 1;
}

/**
 * The traversal, as one statement: walk both directions from every seed at
 * once, never revisiting a node on the same path, and keep one row per
 * reached node — from the earliest seed that reaches it, by its shortest
 * path from that seed. Seeds themselves aren't returned.
 */
export function relatedInitiativesQuery(
  seedIds: string[],
  edgeTypes: EdgeType[],
  maxHops: number,
): SQL {
  const seeds = sql`${`{${seedIds.join(",")}}`}::uuid[]`;
  const types = sql`${`{${edgeTypes.join(",")}}`}::edge_type[]`;
  return sql`
    with recursive walk (seed, ord, node, hops, path) as (
      select s.id, s.ord, s.id, 0, array[s.id]
      from unnest(${seeds}) with ordinality as s (id, ord)
      union all
      select w.seed, w.ord, n.other, w.hops + 1, w.path || n.other
      from walk w
      cross join lateral (
        select e.to_initiative_id as other from edges e
        where e.from_initiative_id = w.node and e.type = any(${types})
        union all
        select e.from_initiative_id from edges e
        where e.to_initiative_id = w.node and e.type = any(${types})
      ) n
      where w.hops < ${clampHops(maxHops)} and n.other <> all(w.path)
    )
    select distinct on (node) node as id, hops, seed as through_id
    from walk
    where hops > 0 and node <> all(${seeds})
    order by node, ord, hops`;
}

/** What's up to `maxHops` relationship steps from any of the seeds. */
export async function relatedInitiativeIds(
  db: Db,
  seedIds: string[],
  edgeTypes: EdgeType[] = ALL_EDGE_TYPES,
  maxHops = 1,
): Promise<RelatedInitiative[]> {
  if (seedIds.length === 0 || edgeTypes.length === 0) return [];
  const rows = await db.execute<{ id: string; hops: number; through_id: string }>(
    relatedInitiativesQuery(seedIds, edgeTypes, maxHops),
  );
  return rows.map((r) => ({ id: r.id, hops: Number(r.hops), throughId: r.through_id }));
}

/**
 * Which ids a neighbourhood shows: the seeds, then the nearest related work,
 * up to `limit`. Pure, so the cap is easy to test.
 */
export function pickNeighbourhood(
  seedIds: string[],
  related: RelatedInitiative[],
  limit: number,
): { ids: string[]; truncated: boolean } {
  const ids = [...new Set(seedIds)];
  const nearest = [...related].sort((a, b) => a.hops - b.hops || a.id.localeCompare(b.id));
  for (const r of nearest) ids.push(r.id);
  return { ids: ids.slice(0, limit), truncated: ids.length > limit };
}

export interface NeighbourhoodOptions {
  initiativeId?: string;
  teamId?: string;
  hops?: number;
  limit?: number;
}

export const NEIGHBOURHOOD_MAX = 300;

/**
 * An initiative and what's around it, or a team's related work and what's
 * around that. Returns ids (nearest first) and the edges between them; the
 * caller loads whichever initiative columns it needs.
 */
export async function neighbourhood(
  db: Db,
  options: NeighbourhoodOptions,
): Promise<{ ids: string[]; edges: (typeof edges.$inferSelect)[]; truncated: boolean }> {
  const limit = Math.max(
    1,
    Math.min(Math.trunc(options.limit ?? NEIGHBOURHOOD_MAX), NEIGHBOURHOOD_MAX),
  );
  const hops = clampHops(options.hops ?? 1);

  let seedIds: string[];
  let seedsTruncated = false;
  if (options.initiativeId) {
    seedIds = [options.initiativeId];
  } else if (options.teamId) {
    // Only the team's work that has relationships: the rest would be
    // unconnected dots. Most recently updated first when there's a lot.
    const rows = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(
        and(
          eq(initiatives.teamId, options.teamId),
          or(
            exists(
              db
                .select({ one: sql`1` })
                .from(edges)
                .where(eq(edges.fromInitiativeId, initiatives.id)),
            ),
            exists(
              db
                .select({ one: sql`1` })
                .from(edges)
                .where(eq(edges.toInitiativeId, initiatives.id)),
            ),
          ),
        ),
      )
      .orderBy(desc(initiatives.updatedAt), desc(initiatives.id))
      .limit(limit + 1);
    seedsTruncated = rows.length > limit;
    seedIds = rows.slice(0, limit).map((r) => r.id);
  } else {
    return { ids: [], edges: [], truncated: false };
  }
  if (seedIds.length === 0) return { ids: [], edges: [], truncated: false };

  const related = await relatedInitiativeIds(db, seedIds, ALL_EDGE_TYPES, hops);
  const picked = pickNeighbourhood(seedIds, related, limit);
  const between = picked.ids.length
    ? await db
        .select()
        .from(edges)
        .where(
          and(
            inArray(edges.fromInitiativeId, picked.ids),
            inArray(edges.toInitiativeId, picked.ids),
          ),
        )
    : [];
  return { ids: picked.ids, edges: between, truncated: seedsTruncated || picked.truncated };
}

// ------------------------------------------------------------ the team map
//
// The graph view opens on the whole organisation as one circle per team,
// with a line per pair of teams whose work is related. Zooming in on a team
// loads its initiatives (`teamGraph`), so the browser only ever holds what's
// on screen. Merged initiatives are left out: they live on in their target.

export interface TeamMapTeam {
  id: string;
  name: string;
  orgUnit: string | null;
  /** Initiatives the team has (not merged). */
  total: number;
  /** How many of them have a relationship with another team's work. */
  connected: number;
  byStatus: Record<string, number>;
}

export interface TeamMapLink {
  fromTeamId: string;
  toTeamId: string;
  type: EdgeType;
  /** Relationships of this type from the one team's work to the other's. */
  count: number;
}

/** Every team with work, and how their work is related, counted per pair of teams. */
export async function teamMap(db: Db): Promise<{ teams: TeamMapTeam[]; links: TeamMapLink[] }> {
  const [counts, ends] = await Promise.all([
    db.execute<{ team_id: string; status: string; count: number }>(sql`
      select team_id, status, count(*)::int as count
      from initiatives where merged_into_id is null
      group by team_id, status`),
    // Both aggregates from one pass over the edges, each end found by its
    // key (a plain "id in (edge ends)" makes the planner scan every initiative).
    db.execute<{
      kind: "link" | "team";
      a: string;
      b: string | null;
      type: EdgeType | null;
      count: number;
    }>(sql`
      with ends as materialized (
        select f.id as fid, f.team_id as ft, t.id as tid, t.team_id as tt, e.type
        from edges e
        join initiatives f on f.id = e.from_initiative_id
        join initiatives t on t.id = e.to_initiative_id
        where f.merged_into_id is null and t.merged_into_id is null
      )
      select 'link' as kind, ft as a, tt as b, type, count(*)::int as count
      from ends where ft <> tt group by ft, tt, type
      union all
      select 'team', team, null, null, count(distinct id)::int
      from (select ft as team, fid as id from ends union all select tt, tid from ends) x
      group by team`),
  ]);
  const connected = ends.filter((r) => r.kind === "team");
  const pairs = ends
    .filter((r) => r.kind === "link")
    .map((r) => ({ from_team: r.a, to_team: r.b!, type: r.type!, count: r.count }));
  const byTeam = new Map<string, { total: number; byStatus: Record<string, number> }>();
  for (const r of counts) {
    const entry = byTeam.get(r.team_id) ?? { total: 0, byStatus: {} };
    entry.total += Number(r.count);
    entry.byStatus[r.status] = Number(r.count);
    byTeam.set(r.team_id, entry);
  }
  const teamIds = [...byTeam.keys()];
  const rows = teamIds.length
    ? await db
        .select({ id: teams.id, name: teams.name, orgUnit: teams.orgUnit })
        .from(teams)
        .where(inArray(teams.id, teamIds))
    : [];
  const connectedBy = new Map(connected.map((r) => [r.a, Number(r.count)]));
  // "related" has no direction: count it once per pair, whichever way it was stored.
  const links = new Map<string, TeamMapLink>();
  for (const p of pairs) {
    const [from, to] =
      p.type === "related" && p.to_team < p.from_team
        ? [p.to_team, p.from_team]
        : [p.from_team, p.to_team];
    const key = `${from}|${to}|${p.type}`;
    const link = links.get(key) ?? { fromTeamId: from, toTeamId: to, type: p.type, count: 0 };
    link.count += Number(p.count);
    links.set(key, link);
  }
  return {
    teams: rows
      .map((t) => ({
        ...t,
        total: byTeam.get(t.id)!.total,
        connected: connectedBy.get(t.id) ?? 0,
        byStatus: byTeam.get(t.id)!.byStatus,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    links: [...links.values()],
  };
}

/** The most initiatives a team's part of the map shows; its list has the rest. */
export const TEAM_GRAPH_MAX = 200;

export interface TeamGraphEdge {
  id: string;
  fromInitiativeId: string;
  toInitiativeId: string;
  fromTeamId: string;
  toTeamId: string;
  type: EdgeType;
}

/**
 * One team's initiatives for the map: those related to other teams' work
 * first, then the most recently updated, up to `limit`. Edges are every
 * relationship touching the team's work (capped far above anything real),
 * with both teams, so the map can draw the ones whose far end is still a
 * closed team circle.
 */
export async function teamGraph(
  db: Db,
  teamId: string,
  limit = TEAM_GRAPH_MAX,
): Promise<{
  nodes: { id: string; title: string; status: string; teamId: string }[];
  total: number;
  edges: TeamGraphEdge[];
}> {
  limit = Math.max(1, Math.min(Math.trunc(limit), TEAM_GRAPH_MAX));
  const node = {
    id: initiatives.id,
    title: initiatives.title,
    status: initiatives.status,
    teamId: initiatives.teamId,
  };
  const ofTeam = and(eq(initiatives.teamId, teamId), sql`${initiatives.mergedIntoId} is null`);
  const hasEdge = or(
    exists(
      db
        .select({ one: sql`1` })
        .from(edges)
        .where(eq(edges.fromInitiativeId, initiatives.id)),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(edges)
        .where(eq(edges.toInitiativeId, initiatives.id)),
    ),
  );
  const newest = [desc(initiatives.updatedAt), desc(initiatives.id)];
  const [connected, recent, [count], touching] = await Promise.all([
    db
      .select(node)
      .from(initiatives)
      .where(and(ofTeam, hasEdge))
      .orderBy(...newest)
      .limit(limit),
    // Enough to fill up after the connected ones, whichever those are.
    db
      .select(node)
      .from(initiatives)
      .where(ofTeam)
      .orderBy(...newest)
      .limit(limit * 2),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(initiatives)
      .where(ofTeam),
    // Both directions, each driven by the team's own initiatives.
    db.execute<{
      id: string;
      from_initiative_id: string;
      to_initiative_id: string;
      from_team: string;
      to_team: string;
      type: EdgeType;
    }>(sql`
      select e.id, e.from_initiative_id, e.to_initiative_id, f.team_id as from_team,
             t.team_id as to_team, e.type
      from initiatives f
      join edges e on e.from_initiative_id = f.id
      join initiatives t on t.id = e.to_initiative_id
      where f.team_id = ${teamId} and f.merged_into_id is null and t.merged_into_id is null
      union
      select e.id, e.from_initiative_id, e.to_initiative_id, f.team_id, t.team_id, e.type
      from initiatives t
      join edges e on e.to_initiative_id = t.id
      join initiatives f on f.id = e.from_initiative_id
      where t.team_id = ${teamId} and f.merged_into_id is null and t.merged_into_id is null
      limit 5000`),
  ]);
  const picked = new Map(connected.map((n) => [n.id, n]));
  for (const n of recent) {
    if (picked.size >= limit) break;
    if (!picked.has(n.id)) picked.set(n.id, n);
  }
  return {
    nodes: [...picked.values()],
    total: Number(count?.n ?? 0),
    edges: touching.map((e) => ({
      id: e.id,
      fromInitiativeId: e.from_initiative_id,
      toInitiativeId: e.to_initiative_id,
      fromTeamId: e.from_team,
      toTeamId: e.to_team,
      type: e.type,
    })),
  };
}
