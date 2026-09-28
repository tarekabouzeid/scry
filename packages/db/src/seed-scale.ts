/**
 * Synthetic data for performance work — NOT the demo story (that's seed.ts).
 * A big org: ~300 teams, ~10k people, SCALE_INITIATIVES initiatives (default
 * 1,000,000) with embeddings, and relationships, "we need this too",
 * status moves and overlaps in proportion. Everything is generated inside
 * Postgres (INSERT … SELECT from generate_series), in batches spread over
 * several connections, so no vectors cross the wire.
 *
 *   SCALE_INITIATIVES=100000 pnpm --filter @scry/db db:seed:scale
 *   SCALE_RESET=true …        wipes all data first (like SEED_RESET)
 *   SCALE_DIMENSIONS=1536     embedding size; 0 leaves embeddings empty
 *   SCALE_CONCURRENCY=8       parallel insert connections
 *
 * Then run tests/perf/queries.mjs against the same DATABASE_URL.
 *
 * Embeddings are unit vectors around 2,000 random "themes", so nearest
 * neighbours mean something: most sit loosely around their theme, and one in
 * fifty sits very close to it, which gives overlap detection real
 * near-duplicates to find. They aren't a model's embeddings: switching the
 * app to a real model re-indexes everything.
 */
import { createDb } from "./client";
import { createVectorIndexSql } from "./vector-index";

const TEAMS = 300;
const USERS = 10_000;
const THEMES = 2_000;
const BATCH = 5_000;

const WORDS = (
  "checkout payments ledger refunds invoices billing pricing discounts coupons " +
  "onboarding signup login passkeys sessions identity permissions audit " +
  "search ranking recommendations feed notifications email push sms " +
  "dashboards analytics reporting metrics experiments forecasting churn " +
  "retention referral loyalty rewards marketing campaigns attribution " +
  "catalog inventory warehouse shipping returns fulfilment logistics " +
  "mobile android ios web accessibility localisation translations theming " +
  "design tokens components library styleguide dark mode " +
  "data platform pipelines streaming events warehouse lakehouse contracts " +
  "feature store models training inference monitoring alerting " +
  "observability tracing logging incidents oncall reliability latency " +
  "kubernetes clusters networking gateway caching queues storage backups " +
  "security scanning secrets compliance privacy consent retention gdpr " +
  "support chat tickets knowledge base self-service automation workflows"
).split(/\s+/);

const TAGS = Array.from({ length: 150 }, (_, i) => `${WORDS[i % WORDS.length]}-${i}`);
const ORG_UNITS = ["Engineering", "Marketing", "Operations", "Product", "Security"];
const COUNTRIES = ["DE", "FR", "NL", "UK", "US"];

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw.replace(/_/g, ""));
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
  return n;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  console.log(`  ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return result;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const total = int("SCALE_INITIATIVES", 1_000_000);
  const dims = int("SCALE_DIMENSIONS", 1536);
  const concurrency = Math.max(1, int("SCALE_CONCURRENCY", 8));
  const { sql } = createDb(databaseUrl, { max: concurrency + 1, onnotice: () => undefined });

  try {
    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from initiatives`;
    if (n > 0 && process.env.SCALE_RESET !== "true") {
      console.log(`The database already has ${n} initiatives. Set SCALE_RESET=true to wipe it.`);
      return;
    }
    console.log(`Seeding ${total} initiatives (${dims || "no"} dimensions)…`);
    const started = Date.now();

    await timed("wiped", () =>
      sql.unsafe(`truncate table teams, users, initiatives, edges, chat_sessions, chat_messages,
        personal_access_tokens, activity, comments, initiative_overlaps, notifications,
        subscriptions, initiative_signals, audit_log, llm_calls, llm_settings
        restart identity cascade`),
    );

    const teamIds = await timed(`${TEAMS} teams`, async () => {
      const rows = await sql<{ id: string }[]>`
        insert into teams (name, org_unit, country)
        select 'Team ' || lpad(g::text, 3, '0'),
               (${ORG_UNITS}::text[])[1 + g % ${ORG_UNITS.length}],
               (${COUNTRIES}::text[])[1 + g % ${COUNTRIES.length}]
        from generate_series(0, ${TEAMS - 1}) g
        order by g
        returning id`;
      return rows.map((r) => r.id);
    });

    // Person i is in team i % TEAMS; the first person in each team runs it.
    const userIds = await timed(`${USERS} people`, async () => {
      await sql`
        insert into users (name, email, team_id, team_admin, tour_seen_at)
        select 'Person ' || g, 'scale-' || g || '@example.test',
               (${teamIds}::uuid[])[1 + g % ${TEAMS}], g < ${TEAMS}, now()
        from generate_series(0, ${USERS - 1}) g`;
      // Indexed by g, so person i's team is teamIds[i % TEAMS].
      const rows = await sql<{ id: string }[]>`
        select id from users order by split_part(split_part(email, '@', 1), '-', 2)::int`;
      return rows.map((r) => r.id);
    });

    if (dims > 0) {
      await sql`drop table if exists scale_themes`;
      await sql`
        create unlogged table scale_themes as
        select t as id, array(select (random() - 0.5)::real from generate_series(1, ${dims})) as v
        from generate_series(0, ${THEMES - 1}) t`;
    }

    const perTeam = Math.floor(USERS / TEAMS);
    // One batch of initiatives [from, to]: every value derived from g and random().
    const insertBatch = (from: number, to: number) => sql`
      insert into initiatives (title, summary, status, tier, team_id, submitted_by,
        contact_person, start_date, target_date, tags, embedding, created_at, updated_at)
      select
        initcap(w[1 + (g * 7) % ${WORDS.length}]) || ' ' || w[1 + (g * 13) % ${WORDS.length}]
          || ' ' || w[1 + (g * 31) % ${WORDS.length}] || ' ' || g,
        'Improve ' || w[1 + (g * 3) % ${WORDS.length}] || ' and ' || w[1 + (g * 17) % ${WORDS.length}]
          || ' for teams that rely on ' || w[1 + (g * 23) % ${WORDS.length}]
          || ', so customers get ' || w[1 + (g * 29) % ${WORDS.length}] || ' without the '
          || w[1 + (g * 37) % ${WORDS.length}] || ' problems we see today.',
        (case when t.s < 0.30 then 'idea' when t.s < 0.50 then 'planned'
              when t.s < 0.75 then 'in_progress' when t.s < 0.80 then 'on_hold'
              when t.s < 0.95 then 'shipped' else 'cancelled' end)::initiative_status,
        (case when g % 5 = 0 then 'strategic' else 'tactical' end)::initiative_tier,
        (${teamIds}::uuid[])[1 + t.i],
        (${userIds}::uuid[])[1 + t.i + ${TEAMS} * floor(random() * ${perTeam})::int],
        (${userIds}::uuid[])[1 + t.i + ${TEAMS} * floor(random() * ${perTeam})::int],
        case when t.s >= 0.30 then (d.created + interval '10 days')::date end,
        case when random() < 0.7 then current_date + (random() * 600 - 200)::int end,
        array_remove(array[tg[1 + g % ${TAGS.length}],
          case when g % 3 = 0 then tg[1 + (g * 11) % ${TAGS.length}] end], null),
        ${
          dims > 0
            ? sql`(select l2_normalize(array_agg(th.v[k] + (random() - 0.5)
                   * (case when g % 50 = 0 then 0.05 else 0.8 end) order by k)::vector)
                 from generate_series(1, ${dims}) k)`
            : sql`null`
        },
        d.created,
        d.created + (now() - d.created) * random()
      from generate_series(${from}::int, ${to}::int) g
      cross join lateral (select random() as s, (g::bigint * 7919 % ${TEAMS})::int as i) t
      cross join lateral (select now() - random() * interval '730 days' as created) d
      cross join (select ${WORDS}::text[] as w, ${TAGS}::text[] as tg) words
      ${dims > 0 ? sql`join scale_themes th on th.id = g % ${THEMES}` : sql``}`;

    // Loading into 14 indexes row by row is several times slower than
    // building them afterwards (and the GIN ones contend on locks), so the
    // secondary indexes go and come back after the load, as they were.
    const secondary = await sql<{ name: string; def: string }[]>`
      select c.relname as name, pg_get_indexdef(i.indexrelid) as def
      from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'initiatives'::regclass and not i.indisprimary
        and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)`;
    for (const { name } of secondary) await sql.unsafe(`drop index "${name}"`);
    // The vector index is built last, on its own (it takes the longest).
    const rebuild = secondary.filter((i) => !i.name.startsWith("initiatives_embedding_hnsw_"));

    // Rebuilt even when the load fails, so a failed run never leaves the
    // table without its indexes.
    try {
      await timed(`${total} initiatives`, async () => {
        let next = 0;
        let done = 0;
        const worker = async () => {
          while (next < total) {
            const from = next;
            const to = Math.min(total, from + BATCH) - 1;
            next = to + 1;
            await insertBatch(from, to);
            done += to - from + 1;
            if (done % 100_000 < BATCH) console.log(`    ${done}`);
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
      });
      if (dims > 0) await sql`drop table scale_themes`;

      // A few confirmed duplicates, merged into the next one along.
      await timed(
        "merged duplicates",
        () => sql`
        update initiatives i set status = 'cancelled', merged_into_id = m.target,
          merged_at = i.updated_at
        from (
          select id, lead(id) over (order by id) as target
          from initiatives where random() < 0.001
        ) m
        where i.id = m.id and m.target is not null`,
      );
    } finally {
      await timed(`${rebuild.length} indexes on initiatives`, async () => {
        const conn = await sql.reserve();
        try {
          await conn.unsafe(`set maintenance_work_mem = '1GB'`);
          await conn.unsafe(`set max_parallel_maintenance_workers = ${concurrency}`);
          for (const { def } of rebuild) await conn.unsafe(def);
        } finally {
          conn.release();
        }
      });
    }

    // Relationships: 5 per 1,000 initiatives, a fifth of them onto 200
    // popular pieces of work, so neighbourhoods two steps out have substance.
    const edgeCount = Math.max(10, Math.round(total * 0.005));
    await timed(
      `~${edgeCount} relationships`,
      () => sql`
      with picked as (
        select id, team_id, submitted_by, row_number() over () as rn
        from (select id, team_id, submitted_by from initiatives
              where merged_into_id is null order by random() limit ${edgeCount * 2}) x
      ),
      hubs as (
        select id, team_id, row_number() over () as rn
        from (select id, team_id from initiatives
              where merged_into_id is null order by random() limit 200) h
      )
      insert into edges (from_initiative_id, to_initiative_id, type, created_by, created_at)
      select a.id, coalesce(h.id, b.id),
             (array['builds_on', 'replaces', 'related'])[1 + (a.rn % 3)::int]::edge_type,
             a.submitted_by, now() - random() * interval '365 days'
      from picked a
      join picked b on b.rn = a.rn + 1
      left join hubs h on a.rn % 10 = 1 and h.rn = 1 + (a.rn / 10) % 200
      where a.rn % 2 = 1 and a.team_id <> coalesce(h.team_id, b.team_id)
      on conflict do nothing`,
    );

    const signalCount = Math.max(10, Math.round(total * 0.02));
    await timed(
      `~${signalCount} "we need this too"`,
      () => sql`
      insert into initiative_signals (initiative_id, user_id, team_id, note, created_at, confirmed_at)
      select i.id, u.id, u.team_id, 'We need this for our roadmap too.', c.at, c.at
      from (
        select id, team_id, floor(random() * ${USERS})::int as k
        from initiatives order by random() limit ${signalCount}
      ) i
      join users u on u.id = (${userIds}::uuid[])[1 + i.k]
      cross join lateral (select now() - random() * interval '400 days' as at) c
      where u.team_id <> i.team_id
      on conflict do nothing`,
    );

    const moves = Math.round(total * 0.2);
    await timed(
      `${moves} status moves`,
      () => sql`
      insert into activity (initiative_id, actor_id, kind, data, created_at)
      select i.id, i.submitted_by, 'status_changed',
             jsonb_build_object('from', 'planned', 'to', i.status),
             now() - random() * interval '365 days'
      from (select id, submitted_by, status from initiatives order by random() limit ${moves}) i`,
    );

    const overlapCount = Math.max(10, Math.round(total * 0.005));
    await timed(
      `~${overlapCount} overlaps`,
      () => sql`
      with picked as (
        select id, team_id, row_number() over () as rn
        from (select id, team_id from initiatives order by random() limit ${overlapCount * 2}) x
      )
      insert into initiative_overlaps (initiative_a_id, initiative_b_id, score, status)
      select least(a.id, b.id), greatest(a.id, b.id), 0.85 + random() * 0.14,
             (case when random() < 0.7 then 'open' else 'dismissed' end)::overlap_status
      from picked a join picked b on b.rn = a.rn + 1
      where a.rn % 2 = 1 and a.team_id <> b.team_id
      on conflict do nothing`,
    );

    await timed("analyze", () => sql`analyze`);

    if (dims > 0) {
      // What the api would do on start (ensureVectorIndex), with more memory
      // and workers so it takes minutes, not hours.
      await timed(`HNSW index (${dims} dimensions)`, async () => {
        const conn = await sql.reserve();
        try {
          await conn.unsafe(
            `set maintenance_work_mem = '${process.env.SCALE_INDEX_MEMORY ?? "2GB"}'`,
          );
          await conn.unsafe(`set max_parallel_maintenance_workers = ${concurrency}`);
          await conn.unsafe(createVectorIndexSql(dims));
        } finally {
          conn.release();
        }
      });
    }

    const [counts] = await sql`
      select (select count(*) from teams)::int as teams, (select count(*) from users)::int as users,
             (select count(*) from initiatives)::int as initiatives,
             (select count(*) from edges)::int as edges,
             (select count(*) from initiative_signals)::int as signals,
             (select count(*) from activity)::int as activity,
             (select count(*) from initiative_overlaps)::int as overlaps,
             pg_size_pretty(pg_database_size(current_database())) as size`;
    console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s:`, JSON.stringify(counts));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
