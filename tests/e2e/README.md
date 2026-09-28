# End-to-end tests

Suites that run against a live Scry stack loaded with the demo story
(`docs/demo.md`). CI runs them on every pull request.

- `api/` — Vitest suites against the HTTP API: authorization and limits,
  AI settings (every auth mode against a demo LLM that enforces auth, a
  stand-in OAuth2 IdP, encryption at rest, re-indexing, vector sizes), the
  audit log, merging (requests, flagged duplicates only) and "we need this
  too", the graph's team map, streamed answers and usage, the portfolio
  brief (its figures, scoping, and the grounded summary), and the MCP server
  (token scopes, every tool, the usage log, and the whole OAuth flow).
- `ui/` — Playwright specs in Chromium: AI setup from nothing, streamed
  Ask Scry answers, registering from chat, asking to merge from an overlap
  card and accepting it, signals, the usage panel and audit log, a
  phone-width check, the workspace (board drag and drop, saved views,
  density, panel resizing, the admin setup checklist), the graph's team map,
  connecting an AI tool (consent page, Settings, the admin switch), and the
  leadership brief.

Each file resets the database to the demo story first, so files are
independent (and run one at a time). Suites sign people in by minting a
session cookie, not through an IdP; try a real sign-in through Keycloak in
the Docker demo after changing it.

## Running locally

```bash
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres (pgvector) + Valkey
pnpm install && pnpm build
pnpm --filter @scry/e2e exec playwright install chromium  # once
pnpm test:e2e
```

`pnpm test:e2e` applies migrations, starts the api, web, two demo LLMs (one
open on :4010, one requiring auth on :4011) and a stand-in IdP (:9998) from
the built output, runs `api/` then `ui/`, and stops them again. Logs are in
`tests/e2e/.stack/`.

**It wipes the database it points at** (`DATABASE_URL`, default
`postgres://scry:scry@localhost:5432/scry`) — never point it at real data.

To iterate on one suite, start the stack once and reuse it:

```bash
node tests/e2e/scripts/stack.mjs start
cd tests/e2e && npx vitest run api/collaboration.test.ts   # or: npx playwright test ui/ask-scry.spec.ts
node tests/e2e/scripts/stack.mjs stop
```

`E2E_EXTERNAL_STACK=1 pnpm test:e2e` runs everything against a stack you
started yourself.

## Documentation screenshots

`pnpm screenshots` (after `pnpm build`) uses the same stack to retake every
image in `docs/screenshots` and the sample brief PDF, from the seeded demo
with the demo LLM connected. The shots are in `screenshots/docs.shots.ts`.
It wipes the database too.
