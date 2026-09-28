#!/usr/bin/env node
// Times the queries behind every request path against a big database
// (seed it with `pnpm --filter @scry/db db:seed:scale`) and checks their
// plans. Read-only; safe against any database.
//
//   DATABASE_URL=postgres://… node tests/perf/queries.mjs [--runs 20] [--plans] [--only brief]
//
// For each query: the plan's top node and whether it used an index scan,
// then cold (first run) and p50/p95 over the runs. --plans prints every
// EXPLAIN (ANALYZE, BUFFERS) in full.
//
// The SQL mirrors what the api sends (list sorts with keyset cursors,
// counts, substring search, vector search in the HNSW form, overlap
// candidates, the relationship walk, the graph's team map, the brief's
// sections, tags). When a
// service's query changes shape, change it here too.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const postgres = require("postgres");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const runs = Number(option("runs", 20));
const only = option("only", "");
const showPlans = flag("plans");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });

// The list's columns, as initiativeListColumns selects them.
const LIST_COLUMNS = `i.id, i.title, i.summary, i.status, i.tier, i.team_id, i.submitted_by,
  i.contact_person, i.start_date, i.target_date, i.tags, i.external_link, i.hold_reason,
  i.merged_into_id, i.merged_at, i.tldr, i.tldr_at, i.created_at, i.updated_at,
  i.embedding is not null as embedding_ready,
  (select count(distinct s.team_id) from initiative_signals s where s.initiative_id = i.id) as signal_teams`;

// What vector search sets for a filtered nearest-neighbour query (search/vector-scan.ts).
const VECTOR_SETUP = [
  "set local hnsw.iterative_scan = relaxed_order",
  "set local hnsw.ef_search = 40",
];

async function samples() {
  const [{ n }] = await sql`select count(*)::int as n from initiatives`;
  const [team] = await sql`
    select team_id as id from initiatives group by team_id order by count(*) desc limit 1`;
  const [hub] = await sql`
    select id, count(*) as n from (
      select from_initiative_id as id from edges union all select to_initiative_id from edges
    ) e group by id order by n desc limit 1`;
  const [edgeTeam] = await sql`
    select i.team_id as id from edges e join initiatives i on i.id = e.from_initiative_id
    group by i.team_id order by count(*) desc limit 1`;
  const [tag] =
    await sql`select tags[1] as tag from initiatives where cardinality(tags) > 0 limit 1`;
  const [vec] = await sql`
    select id, team_id, embedding::text as embedding, vector_dims(embedding) as dims
    from initiatives where embedding is not null
    order by id limit 1 offset ${Math.floor(n / 3)}`;
  // The last row of page 1 (or of everything, on a small database).
  const last = Math.max(0, Math.min(49, n - 1));
  const [page1] = await sql`
    select updated_at, id from initiatives order by updated_at desc, id desc limit 1 offset ${last}`;
  const [title1] =
    await sql`select title, id from initiatives order by title, id limit 1 offset ${last}`;
  const [target1] = await sql`
    select target_date, id from initiatives where target_date is not null
    order by target_date, id limit 1`;
  return { n, team, hub, edgeTeam, tag, vec, page1, title1, target1 };
}

async function cases(s) {
  const dims = s.vec?.dims;
  const q = s.vec?.embedding;
  const list = [
    // --- the initiatives list: each sort, first page and a keyset page
    {
      group: "list",
      name: "updated desc, page 1",
      text: `select ${LIST_COLUMNS} from initiatives i order by i.updated_at desc, i.id desc limit 50`,
    },
    {
      group: "list",
      name: "updated desc, page 2 (keyset)",
      text: `select ${LIST_COLUMNS} from initiatives i
        where (i.updated_at, i.id) < ($1, $2) order by i.updated_at desc, i.id desc limit 50`,
      params: [s.page1.updated_at, s.page1.id],
    },
    {
      group: "list",
      name: "updated asc, page 1",
      text: `select ${LIST_COLUMNS} from initiatives i order by i.updated_at asc, i.id asc limit 50`,
    },
    {
      group: "list",
      name: "title asc, page 2 (keyset)",
      text: `select ${LIST_COLUMNS} from initiatives i
        where (i.title, i.id) > ($1, $2) order by i.title, i.id limit 50`,
      params: [s.title1.title, s.title1.id],
    },
    {
      group: "list",
      name: "title desc, page 1",
      text: `select ${LIST_COLUMNS} from initiatives i order by i.title desc, i.id desc limit 50`,
    },
    {
      group: "list",
      name: "status asc, then updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i
        order by i.status, i.updated_at desc, i.id desc limit 50`,
    },
    {
      group: "list",
      name: "status asc, then id (keyset form)",
      text: `select ${LIST_COLUMNS} from initiatives i order by i.status, i.id limit 50`,
    },
    {
      group: "list",
      name: "target asc (nulls last), page 2",
      text: `select ${LIST_COLUMNS} from initiatives i
        where (i.target_date, i.id) > ($1, $2) order by i.target_date, i.id limit 50`,
      params: [s.target1?.target_date ?? "2000-01-01", s.target1?.id ?? s.page1.id],
    },
    {
      group: "list",
      name: "team filter, updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i where i.team_id = $1
        order by i.updated_at desc, i.id desc limit 50`,
      params: [s.team.id],
    },
    {
      group: "list",
      name: "status filter, updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i where i.status = 'on_hold'
        order by i.updated_at desc, i.id desc limit 50`,
    },
    {
      group: "list",
      name: "tag filter, updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i where i.tags @> array[$1]::text[]
        order by i.updated_at desc, i.id desc limit 50`,
      params: [s.tag.tag],
    },
    {
      group: "list",
      name: "timeline window (from/to)",
      text: `select ${LIST_COLUMNS} from initiatives i
        where coalesce(i.start_date, i.target_date) <= current_date + 90
          and coalesce(i.target_date, i.start_date) >= current_date - 30
        order by i.updated_at desc, i.id desc limit 50`,
    },
    {
      group: "list",
      name: "lookup 200 ids",
      text: `select ${LIST_COLUMNS} from initiatives i
        where i.id = any(array(select id from initiatives order by id limit 200))`,
    },
    // --- counts
    {
      group: "counts",
      name: "by status",
      text: `select status as key, count(*)::int from initiatives group by status`,
    },
    {
      group: "counts",
      name: "by team",
      text: `select team_id as key, count(*)::int from initiatives group by team_id`,
    },
    {
      group: "counts",
      name: "by status, one team",
      text: `select status as key, count(*)::int from initiatives where team_id = $1 group by status`,
      params: [s.team.id],
    },
    // --- substring search (trigram indexes)
    {
      group: "search",
      name: "ilike common word, updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i
        where i.title ilike '%ledger%' or i.summary ilike '%ledger%'
        order by i.updated_at desc, i.id desc limit 50`,
    },
    {
      group: "search",
      name: "ilike rare string, updated desc",
      text: `select ${LIST_COLUMNS} from initiatives i
        where i.title ilike '%' || $1 || '%' or i.summary ilike '%' || $1 || '%'
        order by i.updated_at desc, i.id desc limit 50`,
      params: [" 123457"],
    },
    {
      group: "search",
      name: "command palette (title, limit 10)",
      text: `select i.id, i.title, i.status, i.team_id from initiatives i
        where i.title ilike '%passkey%' order by i.updated_at desc, i.id desc limit 10`,
    },
    // --- tags
    {
      group: "tags",
      name: "tags in use (full scan; cached 60 s)",
      text: `select tag, count(*)::int from initiatives, unnest(tags) tag group by tag`,
    },
  ];

  if (q) {
    list.push(
      {
        group: "vector",
        name: "semantic search top 10",
        setup: VECTOR_SETUP,
        text: `select i.id, i.title, i.embedding <=> $1::vector as distance from initiatives i
          where vector_dims(i.embedding) = ${dims}
          order by i.embedding::halfvec(${dims}) <=> $1::halfvec(${dims}) limit 10`,
        params: [q],
      },
      {
        group: "vector",
        name: "semantic search, one team",
        setup: VECTOR_SETUP,
        text: `select i.id, i.title, i.embedding <=> $1::vector as distance from initiatives i
          where vector_dims(i.embedding) = ${dims} and i.team_id = $2
          order by i.embedding::halfvec(${dims}) <=> $1::halfvec(${dims}) limit 10`,
        params: [q, s.team.id],
      },
      {
        group: "vector",
        name: "overlap candidates (≥ 0.9, other teams)",
        setup: VECTOR_SETUP,
        text: `select i.id, i.embedding <=> $1::vector as distance from initiatives i
          where vector_dims(i.embedding) = ${dims} and i.id <> $2 and i.team_id <> $3
            and i.status not in ('cancelled') and (i.embedding <=> $1::vector) <= 0.1
          order by i.embedding::halfvec(${dims}) <=> $1::halfvec(${dims}) limit 5`,
        params: [q, s.vec.id, s.vec.team_id],
      },
    );
  }

  const walk = (seeds, hops) => `
    with recursive walk (seed, ord, node, hops, path) as (
      select s.id, s.ord, s.id, 0, array[s.id]
      from unnest(${seeds}) with ordinality as s (id, ord)
      union all
      select w.seed, w.ord, n.other, w.hops + 1, w.path || n.other
      from walk w
      cross join lateral (
        select e.to_initiative_id as other from edges e
        where e.from_initiative_id = w.node and e.type = any('{builds_on,replaces,related}')
        union all
        select e.from_initiative_id from edges e
        where e.to_initiative_id = w.node and e.type = any('{builds_on,replaces,related}')
      ) n
      where w.hops < ${hops} and n.other <> all(w.path)
    )
    select distinct on (node) node as id, hops, seed as through_id
    from walk where hops > 0 and node <> all(${seeds})
    order by node, ord, hops`;
  if (s.hub) {
    list.push(
      {
        group: "graph",
        name: "walk 2 steps from the busiest initiative",
        text: walk("array[$1::uuid]", 2),
        params: [s.hub.id],
      },
      {
        group: "graph",
        name: "hybrid search expansion (5 seeds, 1 step)",
        text: walk(
          "array(select id from initiatives order by updated_at desc limit 4) || $1::uuid",
          1,
        ),
        params: [s.hub.id],
      },
      {
        group: "graph",
        name: "team neighbourhood seeds",
        text: `select i.id from initiatives i where i.team_id = $1
          and (exists (select 1 from edges e where e.from_initiative_id = i.id)
            or exists (select 1 from edges e where e.to_initiative_id = i.id))
          order by i.updated_at desc, i.id desc limit 301`,
        params: [s.edgeTeam.id],
      },
      {
        group: "graph",
        name: "map: initiatives per team and status",
        text: `select team_id, status, count(*)::int as count
          from initiatives where merged_into_id is null group by team_id, status`,
      },
      {
        group: "graph",
        name: "map: relationships between teams",
        text: `with ends as materialized (
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
          group by team`,
      },
      {
        group: "graph",
        name: "map: one team's newest 400",
        text: `select id, title, status, team_id from initiatives
          where team_id = $1 and merged_into_id is null
          order by updated_at desc, id desc limit 400`,
        params: [s.edgeTeam.id],
      },
      {
        group: "graph",
        name: "map: relationships touching one team",
        text: `select e.id, f.team_id, t.team_id, e.type
          from initiatives f join edges e on e.from_initiative_id = f.id
          join initiatives t on t.id = e.to_initiative_id
          where f.team_id = $1 and f.merged_into_id is null and t.merged_into_id is null
          union
          select e.id, f.team_id, t.team_id, e.type
          from initiatives t join edges e on e.to_initiative_id = t.id
          join initiatives f on f.id = e.from_initiative_id
          where t.team_id = $1 and f.merged_into_id is null and t.merged_into_id is null
          limit 5000`,
        params: [s.edgeTeam.id],
      },
      {
        group: "graph",
        name: "edges for 200 initiatives",
        text: `select * from edges where from_initiative_id = any($1) or to_initiative_id = any($1)`,
        params: [
          (await sql`select from_initiative_id as id from edges limit 200`).map((r) => r.id),
        ],
      },
    );
  }

  // --- the brief (30-day period); approximations of its queries.
  list.push(
    {
      group: "brief",
      name: "gone quiet: count",
      text: `select count(*)::int from initiatives i
        where i.status in ('planned', 'in_progress') and i.updated_at < now() - interval '45 days'
          and i.merged_into_id is null`,
    },
    {
      group: "brief",
      name: "gone quiet: top 10",
      text: `select i.id, i.title, i.updated_at from initiatives i
        where i.status in ('planned', 'in_progress') and i.updated_at < now() - interval '45 days'
          and i.merged_into_id is null
        order by i.updated_at limit 10`,
    },
    {
      group: "brief",
      name: "gone quiet, count over () (slow form)",
      text: `select i.id, i.title, i.updated_at, count(*) over () as total from initiatives i
        where i.status in ('planned', 'in_progress') and i.updated_at < now() - interval '45 days'
          and i.merged_into_id is null
        order by i.updated_at limit 10`,
    },
    {
      group: "brief",
      name: "most wanted (demand by initiative)",
      text: `select s.initiative_id, count(distinct s.team_id) filter (
          where s.confirmed_at > now() - interval '180 days') as teams
        from initiative_signals s group by s.initiative_id order by teams desc limit 10`,
    },
    {
      group: "brief",
      name: "open overlaps, top 100 by score",
      text: `select * from initiative_overlaps where status = 'open' order by score desc limit 100`,
    },
    {
      group: "brief",
      name: "status moves in period (last per initiative)",
      text: `select distinct on (a.initiative_id) a.initiative_id, a.data, a.created_at
        from activity a where a.kind = 'status_changed' and a.created_at > now() - interval '30 days'
        order by a.initiative_id, a.created_at desc`,
    },
    {
      group: "brief",
      name: "merged in period",
      text: `select id, title, merged_into_id, merged_at from initiatives
        where merged_into_id is not null and merged_at > now() - interval '30 days'`,
    },
    {
      group: "brief",
      name: "status counts, one org unit",
      text: `select i.status, count(*)::int from initiatives i join teams t on t.id = i.team_id
        where t.org_unit = 'Security' group by i.status`,
    },
  );
  return list.filter((c) => !only || c.group === only);
}

async function run(c, explain) {
  const prefix = explain ? "explain (analyze, buffers, format text) " : "";
  return sql.begin(async (tx) => {
    for (const s of c.setup ?? []) await tx.unsafe(s);
    return tx.unsafe(prefix + c.text, c.params ?? []);
  });
}

function summarise(plan) {
  const lines = plan.map((r) => r["QUERY PLAN"]);
  const top = lines[0].replace(/\s+\(cost=.*$/, "").trim();
  const scans = lines
    .map((l) =>
      l.match(
        /(Index Only Scan|Index Scan|Bitmap Index Scan|Seq Scan|Parallel Seq Scan)(?: Backward)?(?: using (\S+))? on (\S+)/,
      ),
    )
    .filter(Boolean)
    .map((m) => (m[2] ? `${m[1]} ${m[2]}` : `${m[1]} ${m[3]}`));
  return { top, scans: [...new Set(scans)].join(", "), lines };
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function main() {
  const s = await samples();
  const [{ size }] = await sql`select pg_size_pretty(pg_database_size(current_database())) as size`;
  const [{ v }] = await sql`select extversion as v from pg_extension where extname = 'vector'`;
  console.log(
    `${s.n.toLocaleString()} initiatives, ${size}, pgvector ${v}, ${runs} runs each` +
      (s.vec ? `, ${s.vec.dims}-d embeddings` : ", no embeddings"),
  );
  const rows = [];
  for (const c of await cases(s)) {
    const t0 = performance.now();
    await run(c, false);
    const cold = performance.now() - t0;
    const times = [];
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      const result = await run(c, false);
      times.push(performance.now() - t);
      if (i === 0) c.rows = result.length;
    }
    times.sort((a, b) => a - b);
    const plan = summarise(await run(c, true));
    rows.push({
      query: `${c.group}: ${c.name}`,
      rows: c.rows,
      cold: cold.toFixed(1),
      p50: pct(times, 50).toFixed(1),
      p95: pct(times, 95).toFixed(1),
      plan: `${plan.top}${plan.scans ? ` [${plan.scans}]` : ""}`,
    });
    if (showPlans) console.log(`\n== ${c.group}: ${c.name}\n${plan.lines.join("\n")}`);
  }
  console.log();
  const cols = ["query", "rows", "cold", "p50", "p95", "plan"];
  const width = Object.fromEntries(
    cols.map((k) => [k, Math.max(k.length, ...rows.map((r) => String(r[k]).length))]),
  );
  const line = (r) =>
    cols
      .map((k) =>
        ["rows", "cold", "p50", "p95"].includes(k)
          ? String(r[k]).padStart(width[k])
          : String(r[k]).padEnd(width[k]),
      )
      .join("  ");
  console.log(line(Object.fromEntries(cols.map((k) => [k, k === "cold" ? "cold" : k]))));
  for (const r of rows) console.log(line(r));
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
