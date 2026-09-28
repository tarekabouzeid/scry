# Scry architecture

How Scry is built: what it talks to, how it's deployed, what's inside the
api, where data lives, and how the main requests flow. Diagrams are
[Mermaid](https://mermaid.js.org/) and render on GitHub; edit them as text.

## 1. Context

Scry is two apps (web and api) in front of Postgres and Valkey (a
Redis-compatible store; "Redis" below means either). People sign
in through the company's identity provider. AI features call any
OpenAI-compatible endpoint the admin connects, and everything still works
without one.

```mermaid
flowchart LR
  people(["People<br/>browser"])
  agents(["AI tools<br/>Claude, Cursor, VS Code…"])
  scripts(["Scripts<br/>imports, reports"])

  subgraph scry["Scry"]
    web["Web app<br/>Next.js 16"]
    api["API<br/>NestJS, 1..n replicas"]
    pg[("Postgres 18<br/>+ pgvector")]
    redis[("Valkey 9<br/>(Redis-compatible)")]
  end

  subgraph external["Connected services"]
    idp["Identity provider<br/>OIDC: Keycloak, Entra ID, Okta…"]
    llm["AI gateway<br/>OpenAI-compatible: LiteLLM, vLLM…"]
    out["Team chat webhook, SMTP"]
  end

  people -- "HTTPS" --> web
  web -- "REST + NDJSON / SSE<br/>session cookie" --> api
  agents -- "MCP over HTTP<br/>OAuth 2.1 token" --> api
  scripts -- "REST<br/>personal access token" --> api
  api -- "SQL" --> pg
  api -- "queues, rate limits,<br/>settings pub/sub" --> redis
  api -- "sign-in: OIDC code + PKCE" --> idp
  api -- "embeddings, chat,<br/>structured output" --> llm
  api -- "alerts, weekly digest" --> out
```

| Talks to Scry | How                              | Credential                                                                   |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| People        | The web app, which calls the api | Session cookie (HS256 JWT, 7 days) after OIDC sign-in                        |
| AI tools      | `POST /mcp` (read-only)          | OAuth 2.1 access token bound to `/mcp`, or a read-only personal access token |
| Scripts       | REST (`/docs` has the OpenAPI)   | Personal access token, read or write                                         |

| Scry talks to      | Why                                                                      | Without it                                                    |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Identity provider  | Sign-in (Authorization Code + PKCE)                                      | Nobody can sign in                                            |
| AI gateway         | Embeddings (search, duplicates), Ask Scry, drafts, TL;DRs, brief wording | Everything else works; AI features hide or explain themselves |
| Chat webhook, SMTP | Real-time alerts (opt-in) and the weekly digest                          | Only the in-app inbox                                         |

## 2. Deployment

The same images run under Docker Compose and the Helm chart. The api is
stateless (sessions are signed cookies, jobs and settings changes go through
Redis), so it scales out; a migrate job runs before it starts.

```mermaid
flowchart TB
  subgraph edge["Ingress / reverse proxy (TLS)"]
    webhost["scry.example.com"]
    apihost["api.scry.example.com"]
  end

  subgraph apps["Application"]
    web["web<br/>Next.js :3000"]
    api1["api replica :3001"]
    api2["api replica :3001"]
    migrate["migrate job<br/>Drizzle migrations"]
  end

  subgraph data["Data"]
    pg[("postgres<br/>pgvector/pgvector:0.8.6-pg18<br/>volume: scry-postgres-data")]
    redis[("redis (valkey:9)<br/>volume: scry-redis-data")]
  end

  subgraph optional["Optional, for demos and dev"]
    keycloak["keycloak 26<br/>demo realm"]
    demollm["demo LLM :4010<br/>deterministic, offline"]
    litellm["LiteLLM proxy"]
    seed["seed job<br/>demo story"]
  end

  webhost --> web
  apihost --> api1
  apihost --> api2
  migrate --> pg
  api1 --> pg
  api2 --> pg
  api1 <--> redis
  api2 <--> redis
  seed --> pg
  api1 -.-> keycloak
  api1 -.-> demollm
  api1 -.-> litellm
```

- `NEXT_PUBLIC_API_URL` is baked into the web build; the browser calls the api
  directly (CORS allows `WEB_ORIGIN`, with credentials).
- The HNSW vector index is built by the api (on boot, and when the embedding
  size changes), not by a migration.
- Backups: `infra/docker/backup.sh` (Postgres dump); Redis holds only queues
  and caches.

## 3. Inside the api

NestJS modules, grouped by job. Controllers are thin; the rules live in
services, and the pure parts (prompts, layout, protocol, permissions) are
unit-tested functions.

```mermaid
flowchart TB
  subgraph entry["Ways in"]
    direction LR
    rest["REST<br/>web app, scripts"]
    streams["Streams<br/>search (SSE), Ask Scry (NDJSON)"]
    mcp["mcp<br/>POST /mcp, OAuth 2.1 server,<br/>usage log, admin switch"]
  end

  subgraph core["Register"]
    direction LR
    initiatives["initiatives<br/>CRUD, import, merges,<br/>demand signals, writing help"]
    edges["edges<br/>relationships, graph map"]
    overlaps["overlaps<br/>cross-team duplicates"]
    teams["teams, users,<br/>onboarding"]
    reports["reports<br/>portfolio brief"]
  end

  subgraph ai["AI"]
    direction LR
    search["search<br/>vector + hybrid, similar work,<br/>HNSW index"]
    chat["chat<br/>Ask Scry, drafting"]
    llm["llm<br/>settings, gateway auth, usage"]
  end

  subgraph background["Background (BullMQ on Redis)"]
    direction LR
    jobs["jobs<br/>embedding → overlaps, tldr"]
    notif["notifications<br/>inbox, alerts, weekly digest"]
  end

  subgraph platform["Platform"]
    direction LR
    auth["auth<br/>OIDC, sessions, tokens"]
    common["common<br/>permissions, rate limits"]
    audit["audit, activity,<br/>comments"]
    db["db<br/>Drizzle, graph walks,<br/>vector index"]
  end

  entry --> core
  entry --> ai
  core -- "save → enqueue" --> background
  background -- "embed, detect" --> ai
  core -- "notify" --> background
  core --> platform
  ai --> platform
  background --> platform
```

| Module          | Owns                                                                | Notes                                                                                |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `auth`          | Sign-in, session cookies, personal access tokens                    | Read tokens can only `GET`; OIDC `returnTo` only accepts app paths                   |
| `initiatives`   | Initiatives, import, merge (and merge requests), "we need this too" | Merges only a flagged duplicate; the target's owners accept unless you can edit both |
| `edges`         | Relationships between teams; the graph's team map                   | Walks at most 2 steps with a recursive CTE                                           |
| `overlaps`      | Likely duplicates across teams                                      | Found after embedding; settled by related / merge / not a duplicate                  |
| `search`        | Vector and hybrid search, similar work                              | Only compares vectors with the current `embedding_key`                               |
| `chat`          | Ask Scry (an agent with search, look-up and register tools)         | Tools keep the rules; evidence only from what tools returned                         |
| `reports`       | The brief                                                           | Every figure computed in SQL; AI may only reword                                     |
| `llm`           | AI settings (secrets encrypted), gateway auth, usage                | Changes broadcast to every replica over Redis                                        |
| `jobs`          | Embedding and TL;DR queues                                          | Backfill on boot and when AI settings change                                         |
| `notifications` | Inbox, follows, alerts, weekly digest                               | Best effort: never fails the action that caused it                                   |
| `mcp`           | MCP endpoint, OAuth 2.1 server, usage log                           | Off until an admin turns it on                                                       |

## 4. Data model

The main tables and how they connect. Initiatives carry their embedding
(an untyped `vector`, compared only within one `embedding_key`).

```mermaid
erDiagram
  teams ||--o{ users : "members"
  teams ||--o{ initiatives : "owns"
  users ||--o{ initiatives : "submits / is contact"
  initiatives ||--o{ edges : "from / to"
  initiatives ||--o{ initiative_overlaps : "pair a / b"
  initiatives ||--o{ initiative_signals : "needed by"
  teams ||--o{ initiative_signals : "needing team"
  initiatives ||--o{ merge_requests : "source / target"
  initiatives |o--o{ initiatives : "merged into"
  initiatives ||--o{ comments : "discussion"
  initiatives ||--o{ activity : "history"
  users ||--o{ notifications : "inbox"
  users ||--o{ subscriptions : "follows"
  users ||--o{ team_join_requests : "asks"
  teams ||--o{ team_join_requests : "decides"
  users ||--o{ chat_sessions : "Ask Scry"
  chat_sessions ||--o{ chat_messages : "turns"
  users ||--o{ personal_access_tokens : "tokens"
  oauth_clients ||--o{ oauth_codes : "issues"
  oauth_clients ||--o{ oauth_grants : "connected as"
  users ||--o{ oauth_grants : "grants"
  users ||--o{ mcp_calls : "asked"
  users ||--o{ audit_log : "did"

  initiatives {
    uuid id PK
    text title
    text summary
    enum status "idea … cancelled"
    enum tier
    uuid team_id FK
    uuid contact_person FK
    text_array tags
    date start_date
    date target_date
    vector embedding
    text embedding_key
    text tldr
    uuid merged_into_id FK
  }
  edges {
    uuid id PK
    uuid from_initiative_id FK
    uuid to_initiative_id FK
    enum type "builds_on, replaces, related"
  }
  initiative_overlaps {
    uuid initiative_a_id FK
    uuid initiative_b_id FK
    real score
    enum status "open, dismissed, linked, merged"
  }
  merge_requests {
    uuid source_id FK
    uuid target_id FK
    enum status "pending, approved, declined, withdrawn"
  }
  personal_access_tokens {
    text token_hash
    enum scope "read, write"
    timestamp expires_at
  }
  oauth_grants {
    text refresh_token_hash
    text scope "scry:read"
    timestamp revoked_at
  }
```

Also: `llm_settings` (one row; secrets AES-256-GCM encrypted), `llm_calls`
(30 days), `app_settings` (the MCP switch), `mcp_calls` (90 days by default).

## 5. Flows

### 5.1 A new initiative is indexed and checked for duplicates

Writes return at once; indexing is background work. Queue `add()` is never
awaited on a request path, so Redis being down never blocks a save.

```mermaid
sequenceDiagram
  autonumber
  actor P as Person
  participant W as Web app
  participant A as API
  participant DB as Postgres
  participant Q as Redis (BullMQ)
  participant J as Job worker (api)
  participant L as AI gateway

  P->>W: New initiative
  W->>A: POST /initiatives
  A->>DB: insert initiative, activity
  A--)Q: enqueue embedding + tldr
  A-->>W: 201 (shown as "Indexing")
  Q->>J: embedding job
  J->>L: embed title + summary + tags
  J->>DB: store vector + embedding_key
  J->>DB: nearest other teams' work (HNSW)
  alt similar enough
    J->>DB: insert initiative_overlaps (open)
    J->>DB: notify both teams' owners and followers
  end
  Q->>J: tldr job (skipped if the input fingerprint is unchanged)
  J->>L: one-line summary (structured output)
  J->>DB: store tldr
```

### 5.2 Ask Scry

An agent: the model decides which tools to call; the tools run in Scry, as
the person, and keep the rules (match strength from scores, no registering
before a search or twice).

```mermaid
sequenceDiagram
  autonumber
  actor P as Person
  participant W as Web app
  participant A as API (chat agent)
  participant S as Search
  participant DB as Postgres
  participant L as AI gateway

  P->>W: "Is anyone working on churn prediction?"
  W->>A: POST /chat/sessions/:id/messages/stream (NDJSON)
  A->>L: conversation + what was searched / mentioned / registered, with tools
  L-->>A: call search_initiatives("Churn prediction …")
  A-->>W: tool (Searching for …)
  A->>S: hybrid search (without the chat's registered initiative)
  S->>DB: vector search, then one relationship step out
  A->>L: results + classification computed from the scores
  opt the idea is clear, or the person asked
    L-->>A: call offer_registration
    A-->>W: tool (Register button)
  end
  L-->>A: answer tokens
  A-->>W: delta, delta, …
  A->>A: evidence = initiatives a tool returned that the answer names
  A-->>W: done (answer, evidence, search, offer)
```

### 5.3 Connecting an AI tool (MCP)

Read-only, always as a person. The tool discovers Scry's OAuth server,
registers itself, and the person approves it on Scry's consent page.

```mermaid
sequenceDiagram
  autonumber
  participant T as AI tool
  participant A as API
  actor P as Person (browser)
  participant W as Web app /connect
  participant I as Identity provider

  T->>A: POST /mcp (no token)
  A-->>T: 401 + resource_metadata URL
  T->>A: GET /.well-known/oauth-protected-resource/mcp
  T->>A: GET /.well-known/oauth-authorization-server
  T->>A: POST /oauth/register (name, redirect URI)
  A-->>T: client_id (public client)
  T->>P: open /oauth/authorize (PKCE S256, resource=/mcp)
  P->>A: GET /oauth/authorize
  A-->>P: redirect to /connect?request=signed
  P->>W: consent page
  opt not signed in
    W->>A: /auth/login?returnTo=/connect…
    A->>I: OIDC sign-in
    I-->>A: callback
    A-->>W: back to /connect
  end
  P->>W: Allow read access
  W->>A: POST /oauth/decision
  A-->>P: redirect to the tool with code + state + iss
  P->>T: code
  T->>A: POST /oauth/token (code + verifier)
  A-->>T: access token (1 h, aud=/mcp) + refresh token (30 d, rotates)
  T->>A: POST /mcp tools/call search_initiatives
  A->>A: check grant, MCP switch, rate limit
  A-->>T: results with links to Scry
  A--)A: log the call (mcp_calls)
```

### 5.4 The Graph's team map

The browser never loads the whole register. It gets one circle per team,
then opens teams as they get big enough on screen, within a node budget.

```mermaid
flowchart LR
  overview["GET /graph/overview<br/>teams, counts by status,<br/>relationships per pair of teams"]
  layout["layoutTeams()<br/>fixed positions, circles sized<br/>for what each can show"]
  zoom{"zoom / pan"}
  pick["pickOpenTeams()<br/>spacing or size on screen,<br/>biggest first, 1,500 node budget"]
  detail["GET /graph/teams/:id<br/>up to 200 initiatives,<br/>related work first"]
  scene["buildScene()<br/>initiatives inside open circles,<br/>lines to what's drawn"]
  canvas["canvas<br/>labels placed without overlaps"]

  overview --> layout --> scene
  zoom --> pick --> detail --> scene
  scene --> canvas --> zoom
```

## 6. Credentials at a glance

| Credential                    | Issued by                   | Lifetime                 | Accepted by         | Can write            |
| ----------------------------- | --------------------------- | ------------------------ | ------------------- | -------------------- |
| Session cookie                | `/auth/callback` after OIDC | 7 days                   | Every REST endpoint | Yes, per permissions |
| Personal access token (read)  | Settings → API tokens       | Chosen, or never expires | REST `GET`, `/mcp`  | No                   |
| Personal access token (write) | Settings → API tokens       | Chosen, or never expires | REST, `/mcp`        | Yes, per permissions |
| MCP access token              | `/oauth/token`              | 1 hour                   | `/mcp` only         | No                   |
| MCP refresh token             | `/oauth/token`              | 30 days, rotates on use  | `/oauth/token`      | No                   |

Permissions (who may edit, relate or merge) live in
`apps/api/src/common/permissions.ts` and are mirrored in
`apps/web/src/lib/permissions.ts`. Session and MCP tokens are signed with
keys derived from `SESSION_SECRET` per purpose, so one can never pass as
the other.
