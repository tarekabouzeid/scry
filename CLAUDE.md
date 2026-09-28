# CLAUDE.md

How Scry is built and the rules it follows, for contributors and the AI
coding agents they use (Claude Code reads this file). User-facing docs are
`README.md`, `docs/user-guide.html`, `docs/demo.md` and `docs/pilot.md`;
`docs/architecture.md` has the diagrams. Internals belong here, not there.

## What Scry is (and isn't)

An organisation's shared register of initiatives: ideas, plans and work in
progress. Its job is to surface related work early: duplicates across
teams, which teams build on each other's work, and demand from other teams.
It is **not** a delivery tracker: no sprints, estimates, assignees, task
breakdowns or dependency chains. Keep new features in that spirit.

Product principles:

- **AI assists, people decide.** Drafts and suggestions are shown for the
  author to accept; nothing is changed or saved by AI on its own. AI output
  is labelled as AI-written.
- **Ground AI in data.** Prompts carry only the facts needed, the model is
  told not to invent anything, and outputs that cite things (brief summary,
  Ask Scry) are validated against real ids; uncited points are dropped.
- **Figures are computed, not generated.** Reports (the brief) compute every
  number in code; AI may only summarise them.
- **Everything works without AI.** Features that need a model hide or
  disable themselves with a short explanation when none is connected.
- **Relationships are for awareness, not scheduling.** Only between
  different teams, one per pair: `builds_on`, `replaces`, `related`. Nothing
  is computed from the graph (no "blocked by" chains); search follows it one
  step. Status "on hold" is set by people, with an optional reason.
- **Demand counts teams, with reasons.** "We need this too" needs a note;
  a team that asks and builds on something counts once; requests not
  confirmed for 6 months fade (`DEMAND_STALE_AFTER_DAYS`).
- **Outside AI tools only read, and always as a person.** The MCP server has
  no write tools, needs a signed-in person (OAuth or a token), is off until
  an admin turns it on, and logs every call.
- **Merging needs both sides.** Only a flagged duplicate can be merged, and
  the target's owners accept unless the person merging can edit both.
- **Plain UI copy.** Short, specific, no jargon or hype. Match the tone of
  existing screens.

## Layout

```
apps/api        NestJS API (port 3001). OpenAPI at /docs.
apps/web        Next.js 16 app (port 3000). One client-side app shell.
packages/db     Drizzle schema, migrations, seeds (demo story, scale), graph walks, vector index.
packages/shared Wire types shared by api and web (build before api/web).
infra/docker    Compose files (stock pgvector/pgvector:0.8.6-pg18, Valkey), demo LLM, Keycloak realm.
infra/helm      Helm chart.
tests/e2e       Live-stack API (Vitest) and browser (Playwright) suites.
tests/perf      Query timings and plans against a big database (queries.mjs).
docs            User guide, demo and pilot guides, architecture diagrams, screenshots, sample brief PDF.
```

### API modules (`apps/api/src`)

- `auth`: OIDC login (Authorization Code + PKCE), session cookie (HS256 JWT
  signed with `SESSION_SECRET`), personal access tokens (read or write).
- `initiatives`: CRUD, import, merge (`merge.service.ts`), "we need this
  too" signals (`signals.service.ts`), AI writing help (`assist.service.ts`).
  Only a flagged duplicate (an open overlap) can be merged; marking the
  pair related or not a duplicate closes any request for it.
  A merge happens at once only if the person can edit both initiatives
  (admins, or someone who owns both); otherwise it's a `merge_requests` row
  the target's owners or team admins accept (`/merge-requests/:id/approve`)
  or decline, and the asker can withdraw. Notifications: `merge_request`
  (to the deciders), `merge_update` (declined / withdrawn), `merged` (both
  sides' owners, followers and team admins).
- `edges`: relationships between teams (`builds_on`, `replaces`, `related`),
  stored only in the `edges` table and walked with a recursive CTE
  (`packages/db/src/graph.ts`, at most 2 steps). The Graph view reads
  `GET /graph/overview` (every team with work, relationships counted per
  pair of teams) and `GET /graph/teams/:id` (a team's initiatives, related
  work first, capped at 200, plus every relationship touching them).
  `GET /graph/neighbourhood` (an initiative or a team's related work, capped
  at 300) is kept for API users; `GET /edges` needs `initiativeIds` (max 200).
- `overlaps`: cross-team duplicate detection after embedding.
- `search`: vector search, hybrid search with graph expansion (all seeds
  in one query; + SSE stream), `/search/similar` for the create form.
  `vector-index.service.ts` keeps the HNSW index in step with the
  configured embedding size (on boot and when AI settings are saved).
- `chat`: Ask Scry, a tool-using agent (`LlmService.agent()`, AI SDK
  `streamText` with tools, up to 5 steps) streamed as NDJSON; drafting from
  a chat. Tools run in Scry as the person: `search_initiatives` (hybrid
  search; the match classification is computed from scores, and the chat's
  registered initiative is left out), `get_initiative`, and
  `offer_registration` (refused before any search and once registered).
  Each turn the system prompt says what was searched, which initiatives
  were mentioned (with ids) and whether the idea is registered. Evidence is
  what a tool returned _and_ the answer names by title.
  `chat_messages.search_query` / `register_ready` record a search and an
  offer; the web shows the Register card after any search (the person
  decides), worded by whether it was offered.
- `reports`: the portfolio brief (`reports.service.ts`), its computed
  summary sentences (`summary.ts`) and the optional AI rewording
  (`narrative.ts`).
- `llm`: admin-managed AI settings stored in Postgres, secrets encrypted
  (`secret-box.ts`), auth modes (`llm-auth.ts`), usage recording, host
  allowlist. Settings changes are broadcast over Redis pub/sub so every API
  replica reloads.
- `jobs`: BullMQ queues. `embedding` (then overlap detection) and `tldr`
  (one-line summaries; skipped when the input fingerprint is unchanged).
  Both backfill on boot and when AI settings are saved.
- `mcp`: the read-only MCP server for AI tools (`POST /mcp`, Streamable
  HTTP, stateless, JSON answers; the protocol is `mcp-protocol.ts`, no SDK)
  and Scry as its OAuth 2.1 authorization server (`oauth.service.ts`):
  discovery metadata, dynamic client registration (public clients, safe
  redirect URIs), authorize → the web app's consent page (`/connect`) →
  code with PKCE S256 → a 1-hour access token bound to `/mcp` (HS256 with a
  key derived from `SESSION_SECRET` per purpose, so it can never pass as a
  session) and a rotating 30-day refresh token (an `oauth_grants` row,
  revocable). Read-only personal access tokens work too. Tools in
  `mcp-tools.ts` (definitions and argument parsing, unit-tested), run by
  `mcp-tools.service.ts` through the same services as the web app. Off until
  an admin turns it on (`app_settings`, audited); every call goes to
  `mcp_calls` (kept `MCP_LOG_RETENTION_DAYS`, default 90).
- `notifications`, `activity`, `audit`, `teams`, `users`, `onboarding`.
- `common/permissions.ts`: who may edit/relate initiatives. The web app
  mirrors these rules (e.g. which board cards are draggable); change both.
- `common/throttle.ts`: per-caller rate limits in Redis (fail open). Endpoints
  that call a model use `LlmThrottle()`.

### Web app (`apps/web/src`)

- `app/connect/page.tsx` is the OAuth consent page AI tools send people to
  (outside the app shell); sign-in comes back to it via `returnTo`.
- `app/page.tsx` → `components/app-view.tsx` is the shell; views live in
  `components/*-view.tsx`, `initiative-table.tsx`, `initiative-kanban.tsx`.
- URL state (view, filters, selected initiative, brief period…) is in
  `lib/url-state.ts`; everything shareable belongs there.
- Server data via React Query (`lib/queries.ts`, `lib/api.ts`).
- Per-browser preferences (density, panel width, saved views) via
  `lib/prefs.ts` (`usePref`).
- The Graph view (`graph-view.tsx`) is a map drawn by `react-force-graph-2d`
  with fixed positions: `lib/graph-map.ts` (pure, unit-tested) lays out team
  circles (sized for what they can show, so opening one moves nothing),
  places initiatives inside, decides which teams are open at the current
  zoom (within a node budget), merges lines, and places labels without
  overlaps. Nothing is simulated live.
- Theme tokens are CSS variables in `app/globals.css` (light, dark and print)
  that its Tailwind 4 `@theme` block maps to utilities (there's no
  `tailwind.config`). Use tokens, not raw colours.

## Commands

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres + Valkey for dev
pnpm --filter @scry/db db:migrate
pnpm --filter @scry/db db:seed        # SEED_RESET=true wipes and reseeds
pnpm dev

pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm build                            # needed before e2e
pnpm test:e2e                         # starts its own stack; WIPES DATABASE_URL

pnpm --filter @scry/db db:generate --name <change>   # after editing packages/db/src/schema
pnpm demo:llm                         # offline demo LLM on :4010
```

Build order matters: `@scry/shared` and `@scry/db` must be built before
type-checking or building `api`/`web` (turbo handles it for `pnpm build`).

## Testing

- **Unit tests** (Vitest) sit next to the code (`*.test.ts`), mostly for
  prompt builders and pure logic.
- **E2E** (`tests/e2e`): `scripts/stack.mjs start|stop` runs the built api
  and web plus the demo LLM (:4010, and :4011 requiring auth) and a stand-in
  IdP (:9998). Suites reset the database to the demo story and sign people
  in by minting session cookies. Iterate with the stack running:
  `npx vitest run api/<file>` or `npx playwright test ui/<file>`.
- **The demo LLM is deterministic** (`infra/docker/demo-llm/server.mjs`). It
  picks a handler by a key in the request's JSON schema (`headline`,
  `coverage`, `tldr`, else the draft); Ask Scry requests (they carry the
  `search_initiatives` tool) go to `agentStep`, which calls tools or answers
  one step at a time. **When you add an LLM call
  with a new schema, add a handler there**, or the demo and e2e tests break.
- Add e2e coverage for new user-facing flows; prefer role/label selectors.
- **CI** (`.github/workflows/ci.yml`) runs the checks and both e2e suites.
- The one thing e2e can't cover is a real IdP: after touching sign-in, sign
  in through Keycloak in the Docker demo (`docs/demo.md`).

## Conventions

- Prettier formats everything (`pnpm format`). Comments explain _why_, not
  what; match the density of surrounding code.
- Schema changes go through `db:generate`; don't hand-write migration SQL.
  Nothing is installed anywhere yet, so there's one migration: fold a
  change into `0000_init` (delete the migrations, `db:generate --name init`,
  put back its extensions header, keep the snapshot id and journal
  timestamp) instead of adding `0001`.
- Git: `main` only, one commit ("Scry: initial public release"); amend
  into it, no branches or PRs.
- New admin actions are recorded in the audit log (`AuditService`).
- New AI features: throttle the endpoint, record usage (automatic via
  `LlmService`), keep the prompt in a pure, unit-tested function, and
  support the no-model case.
- Dialogs get an accessible name (the shared `Dialog` wires the title).
- Keep `docs/user-guide.html`, `docs/demo.md` and the README screenshots in
  step with user-visible changes, and `docs/architecture.md` (Mermaid) in
  step with new modules, tables, services or flows.

## Onboarding tour

`components/product-tour.tsx` (spotlight + card) with the steps in
`components/help-menu.tsx` (`tourSteps`). Steps point at elements by
`data-tour="…"`; a step can list fallbacks (the phone menu button) and
centres itself when nothing is visible. It starts once per user on the first
visit (`users.tour_seen_at`, set by `POST /auth/me/tour-seen` on finish or
skip) and can be replayed from the header's Help menu, which also opens the
user guide (served at `/guide/index.html`, copied from `docs/` by
`apps/web/scripts/copy-guide.mjs` before dev and build) and the shortcuts
(`?`). **When you add or move a main UI element, update the tour steps and
their `data-tour` anchors.** E2E `resetDemo()` marks the tour seen for every
demo user; `ui/tour.spec.ts` clears it to test the tour.

## Pitfalls we've hit

- **TanStack Table `data` must be referentially stable.** A fresh `[]` each
  render froze the Initiatives page (page-index auto-reset loop). Use a
  shared empty array.
- **The HNSW index is app-managed, not a migration.** The embedding size is
  an admin setting, so `ensureVectorIndex` (`packages/db/src/vector-index.ts`)
  builds `initiatives_embedding_hnsw_<N>` on `embedding::halfvec(N)`, partial
  on `vector_dims(embedding) = N`, and drops other sizes'. A query only uses
  it if it repeats that cast and predicate with N as a **literal** (use
  `halfvecDistance()` / `sameVectorSize()`), orders by the halfvec distance
  and runs inside `withVectorScan()` (iterative scan, so filters don't
  starve the result). Score with the exact `<=>` and re-sort.
- **Keyset cursors need the index's column order and direction.** The list
  indexes are `(updated_at desc, id desc)`, `(team_id|status, updated_at
desc, id desc)`, `(title, id)`, `(target_date, id)`; paginate with a row
  comparison in one direction (`(updated_at, id) < ($1, $2)`, order both
  desc, or both asc for a backward scan). Mixed directions or `coalesce()`
  on the sort column fall back to sorting the whole table. `target_date` is
  nullable: nulls sort last ascending, so the cursor must handle them.
- **Drizzle `.desc()` in an index means `DESC NULLS LAST`**, which a plain
  `order by x desc` can't use; write `.desc().nullsFirst()`.
- **`NEXT_PUBLIC_API_URL` is baked in at build time**, not read at runtime.
- **Embeddings from different models aren't comparable, even at the same
  size.** Each vector carries `embedding_key` (a hash of model, size and
  endpoint, `embeddingKey()`); search and overlap checks only compare rows
  with the current key, and a different key marks a row for re-embedding.
  The `embedding` column is an untyped `vector`; a new size also swaps the
  HNSW index.
- **Nest answers every POST with 201**, even with `@Res()`. OAuth's token
  endpoint must answer 200 (RFC 6749), so it sets the status itself.
- BullMQ `add()` is never awaited on request paths (it hangs if Redis is
  down); jobs are best-effort background work.
- **force-graph moves the camera by itself** on the first data (zoom
  `4/∛n` while the view is untouched), and its `onZoom`/`onZoomEnd` pass the
  world point at the view's centre, not the pan offset. The Graph view
  hides the canvas until its own first fit, and reads the camera back with
  `zoom()` / `centerAt()`. Centre and zoom are one move (both tweens at
  once); never fit and then clamp in a second step.
- Keycloak advertises browser-facing URLs; the API container needs the
  compose service name (see the demo overlay). openid-client 6 rejects an
  issuer that differs from the discovery URL, so `OidcService` discovers
  from the well-known document and checks the issuer's path itself.
- **AI SDK: use `provider.chat(model)`.** The bare `provider(model)` calls
  OpenAI's Responses API, which gateways (LiteLLM, the demo LLM) don't
  serve. Per-call options (`user`, `dimensions`) go in `providerOptions`.
- **TypeScript 6** loads no `@types/*` unless listed: packages that use Node
  set `"types": ["node"]`. `@nestjs/swagger` and typescript-eslint don't
  support TS 7 yet.
- **pnpm 12 holds back versions published in the last day**
  (`minimumReleaseAge`). A just-released package won't install until then;
  don't add it to `minimumReleaseAgeExclude` to get around that.
- **Postgres 18 images keep data in `/var/lib/postgresql/18/docker`**, so
  the volume mounts at `/var/lib/postgresql`, not `.../data`.

## Screenshots

`docs/screenshots/*.png` and `docs/samples/portfolio-brief.pdf` come from
the seeded demo (1440×900, dark unless noted) with the demo LLM connected.
Retake them all with one command after visible UI changes:

```bash
pnpm build && pnpm screenshots   # starts its own stack; WIPES DATABASE_URL
```

The shots live in `tests/e2e/screenshots/docs.shots.ts` (own Playwright
config, `playwright.screenshots.config.ts`). The `guide-*` images are
fixed-size crops for the user guide; keep their sizes in step with the
`width`/`height` in `docs/user-guide.html`. Look at the results before
committing: the demo data drives what's on screen.

## Known gaps

- Answer, draft, TL;DR and brief-summary quality with a real chat model,
  and the default match and overlap thresholds with a real embedding model.
  The demo LLM's word-hash embeddings miss conversational phrasing ("who is
  working on churn") that a real model would match.
- The Helm chart on a real cluster.
- Claude Code, Cursor and VS Code against a deployed Scry over https (their
  own OAuth handling, redirect URIs and client names).
- The JWT auth modes against a licensed LiteLLM (its JWT auth is an
  Enterprise feature).

## Scale

Target: one instance with 1M initiatives and 10k people, every request
path under 300 ms p95 and the brief under 1 s cold. To measure:

```bash
SCALE_INITIATIVES=1000000 SCALE_RESET=true pnpm --filter @scry/db db:seed:scale
DATABASE_URL=… node tests/perf/queries.mjs            # --plans for full EXPLAINs
```

The scale seed generates everything inside Postgres (random unit vectors
around 2,000 themes) and builds the HNSW index at the end. Give Postgres
room: the numbers below used `shared_buffers=3GB`, `--shm-size=4g` and
`maintenance_work_mem=4GB` for the index build. The api builds the same
index on boot or after a model change, raising `maintenance_work_mem` for
that one connection to `VECTOR_INDEX_MEMORY` (default 1GB; the server's
64 MB default would make a 1M-row build take hours). Postgres needs that
much free memory while it builds.

Measured on a 28-core workstation (Postgres 16 + pgvector 0.8.6 in Docker)
at **1,000,000 initiatives**, 300 teams, 10k people, ~5k relationships,
~20k demand signals, 200k status moves, ~5k overlaps, 1536-d embeddings;
12 GB database. Seed: inserts 5 min, HNSW build 2.5 min, plus the other
indexes. p95 over 20 warm runs, in ms:

| Path                                                      |            p95 | Plan                                          |
| --------------------------------------------------------- | -------------: | --------------------------------------------- |
| List page, any of the 4 sorts, first or keyset page       |            1–2 | index scan on the sort's index                |
| List filtered by team / status / tag / window             |            1–5 | same                                          |
| Counts by status or team (whole org)                      |             53 | parallel seq scan                             |
| Substring search (`ilike`, title or summary)              |              2 | trigram GIN, or the sort index                |
| Tags in use                                               |            128 | seq scan (cache it)                           |
| Semantic search top 10 / within one team                  |         3 / 62 | HNSW / team index                             |
| Overlap candidates (background job)                       |            131 | HNSW, iterative scan                          |
| Relationship walk (2 steps), 5-seed expansion, team seeds |            1–3 | edge indexes                                  |
| Graph map: per team and status / between teams / one team | 72 / 32 / ≤ 10 | parallel seq scan / edges + pkey / team index |
| Brief sections (each)                                     |           ≤ 65 | see `--only brief`                            |

Cold (right after a restart) the first semantic search took 147 ms and the
first overlap check 5 s (reading vectors from disk); both warm up at once.
Things the numbers ruled out: `count(*) over ()` next to a `limit` (600 ms;
count separately), and sorting by status without `(status, id)`
(270 ms; that index is in the schema now).

Through the built api (HTTP, same database, p95 over 20 runs): list pages
5–9 ms for every sort, keyset page and filter; the timeline's 200-row
window 157 ms; counts 56–60 ms; tags 4 ms (cached); neighbourhoods
7–13 ms; `/edges` and `/overlaps` ≤ 5 ms. The brief, cold: 0.52 s for 90
days, 0.62 s for one org unit, 0.84 s for 30 days, **1.24 s for All
time** (8 ms cached). All time misses the 1 s target: "What's emerging"
unnests the tags of every open initiative (~1.2 s). The cache key includes
a fingerprint of the data, so on a busy install most brief loads are cold.

The Graph's map (the 1M database, 300 teams): `/graph/overview` is two
queries in parallel, initiatives per team and status (~70 ms, seq scan) and
relationships between teams (~30 ms; joining each edge end by key; a plain
`id in (edge ends)` made the planner scan every initiative, 120 ms). A
team's detail is ~10 ms. In the browser the map is ready in ~0.6 s, the
team layout takes <100 ms for 300 teams (~0.8 s for 1,000), and it draws at
60 fps with 7 teams (1,400 initiatives, the budget) open.

## Roles

- **Admin** (`users.role = admin`): not in a team by default; sees and runs
  everything. Approves new teams, files initiatives for any owner (the
  initiative goes to the owner's team), manages people and AI settings, and
  reads the full audit log, and turns AI tool (MCP) access on or off.
  People listed in `INITIAL_ADMIN_EMAILS` become admins on first sign-in
  (or again if the install has no admin left); nobody else ever does by
  signing in.
- **Team admin** (`users.team_admin`): runs their own team from the **Team**
  page. Lets in (or declines) people who ask to join, removes members, gives
  or takes team admin rights (a team with members keeps at least one), edits
  any of the team's initiatives, and sees the team's audit entries
  (`audit_log.team_id`). Can't rename the team or change its org unit or
  country.
- **Member**: edits their own initiatives (as submitter or contact).
- **Waiting**: someone who asked to join a team, or asked for a new team
  (`teams.status = pending`), can look around but not write anything until
  approved; a banner says what they're waiting for, with **Withdraw**.
  Requests notify the deciders (the team's admins, or admins if it has none;
  admins for new teams), and the answer notifies the requester
  (`team_request` / `team_update` notifications, not tied to an initiative).
- Org units and countries come from `ORG_UNITS` / `COUNTRIES` (comma
  separated; defaults match the demo) and are validated on every team write.
