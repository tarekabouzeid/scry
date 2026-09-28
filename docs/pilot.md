# Running a pilot

A checklist for running Scry for real with one or two teams, on a single
server with Docker Compose. It assumes you've tried the demo
([docs/demo.md](demo.md)) and read the README.

## 1. What you need

- A Linux server with Docker and Docker Compose (2 CPUs and 4 GB of RAM is
  plenty for a pilot).
- Two HTTPS names on the same domain, for example `scry.example.com` (the
  web app) and `api.scry.example.com` (the API), with a reverse proxy such as
  Caddy or nginx in front. Sign-in uses a secure cookie, so it needs HTTPS,
  and the two names must share a domain.
- An app registration in your identity provider (Okta, Azure AD / Entra ID,
  Google Workspace, Keycloak…) with the redirect URI
  `https://api.scry.example.com/auth/callback`.
- An OpenAI-compatible AI endpoint (a LiteLLM gateway, OpenAI, Azure OpenAI…)
  with a chat model and an embedding model. Scry works without one, but Ask
  Scry, duplicate detection, TL;DRs and drafting need it.
- The bundled Postgres (the stock `pgvector/pgvector:0.8.6-pg18` image) is all
  a pilot needs. To use a managed Postgres instead, it needs version 16 or
  later with the `vector` extension at **0.8 or later** (search relies on
  its iterative index scans) and `pg_trgm`.

## 2. Configure `.env`

```bash
cp .env.example .env
```

| Setting                                                   | Set it to                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                | `production` (makes the session cookie secure).                                                                     |
| `SESSION_SECRET`                                          | A new random value: `openssl rand -hex 32`.                                                                         |
| `SETTINGS_ENCRYPTION_KEY`                                 | Another random value. It encrypts the AI credentials admins save; keep it, or they must be entered again.           |
| `POSTGRES_PASSWORD`                                       | A strong password (the default is `scry`).                                                                          |
| `WEB_ORIGIN`                                              | `https://scry.example.com`                                                                                          |
| `NEXT_PUBLIC_API_URL`                                     | `https://api.scry.example.com` (built into the web app: set it before building).                                    |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From your identity provider.                                                                                        |
| `OIDC_REDIRECT_URI`                                       | `https://api.scry.example.com/auth/callback`                                                                        |
| `INITIAL_ADMIN_EMAILS`                                    | The pilot's admins, comma-separated. **Set it before anyone signs in**: nobody else becomes an admin by signing in. |
| `ORG_UNITS`, `COUNTRIES`                                  | Your organisation's lists; teams are filed under these.                                                             |
| `TRUST_PROXY`                                             | `1` behind one reverse proxy, so rate limits see people's addresses rather than the proxy's.                        |
| `LLM_ALLOWED_HOSTS`                                       | Your AI endpoint's host (e.g. `litellm.internal:4000`), so AI traffic can't be pointed anywhere else.               |
| `API_PORT`, `WEB_PORT`                                    | `127.0.0.1:3001` and `127.0.0.1:3000`, so only the reverse proxy can reach them.                                    |

Optional: `NOTIFICATIONS_*` and `SMTP_*` for a weekly email or chat digest
(see the README), and `API_PUBLIC_URL` if AI tools reach the api at a
different address than `NEXT_PUBLIC_API_URL`.

## 3. Start it

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
curl -s https://api.scry.example.com/health
```

Migrations run automatically on every start. Postgres and Valkey aren't
published outside the Compose network. Don't add the demo or Keycloak
overlays: they ship well-known passwords.

## 4. First steps as admin

1. Sign in with an address from `INITIAL_ADMIN_EMAILS`. Admins aren't in a
   team; they see and run everything.
2. **Admin → AI & models**: connect your endpoint, pick a model for each job,
   **Test connection**, **Save**. Existing initiatives are indexed in the
   background.
3. **Admin → Teams → New team** for the pilot teams (or let people ask for
   theirs and approve them there).
4. Ask one person per team to sign in, ask to join, and be let in; then
   make them the team admin (Admin → People, or their Team page). From then
   on, team admins let their colleagues in.
5. Optional: **Admin → Import initiatives** from a CSV or Jira export.
6. Optional: **Admin → AI tools → Turn on** to let people ask Scry from
   Claude, Cursor or VS Code (read only, as themselves). Decide first whether
   register data may go to those tools' AI providers.

## 5. Backups

```bash
infra/docker/backup.sh        # writes backups/scry-<date>.dump
```

Run it daily (for example from cron: `0 2 * * * cd /opt/scry &&
infra/docker/backup.sh`), copy `backups/` off the server, and delete old
ones.

To restore into an empty database:

```bash
docker compose -f infra/docker/docker-compose.prod.yml stop api web
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres dropdb -U scry scry
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres createdb -U scry scry
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_restore -U scry -d scry --no-owner < backups/scry-<date>.dump
docker compose -f infra/docker/docker-compose.prod.yml start api web
```

Try a restore once before the pilot starts.

## 6. Upgrades

```bash
infra/docker/backup.sh
git pull
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
```

## 7. Before you invite people

- [ ] HTTPS works for both names, and signing in lands back on the web app.
- [ ] An admin from `INITIAL_ADMIN_EMAILS` can open Admin; someone else
      can't.
- [ ] **Test connection** is green for all three AI roles, and Ask Scry
      answers a question about an initiative you added.
- [ ] Someone asks to join a team, its team admin is notified and lets them
      in.
- [ ] The brief opens, and **Print or save PDF** looks right.
- [ ] If AI tools are on: one person connects Claude Code (or another MCP
      client) with the address in Settings → AI tools, and the call shows
      under Admin → AI tools.
- [ ] A backup was taken and restored once.
- [ ] You know who to tell about problems: the audit log (Admin → Audit
      log) shows who changed what.
