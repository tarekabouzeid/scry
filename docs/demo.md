# Scry demo

A ready-made product organisation whose data tells one story, so you can try
every Scry feature in about fifteen minutes: no accounts, API keys or
internet access needed.

## Start it

Docker only, from the repo root:

```bash
cp .env.keycloak.example .env
docker compose -f infra/docker/docker-compose.prod.yml \
               -f infra/docker/docker-compose.keycloak.yml \
               -f infra/docker/docker-compose.demo.yml up -d --build
```

Give Keycloak ~20 seconds on first boot, then open **http://localhost:3000**
and sign in as **alice** to [switch on the AI](#0-switch-on-the-ai-alice)
— the demo data is all there, but Ask Scry, semantic search and overlap
detection stay off until an admin connects a model. The stack includes:

| Service  | What it does in the demo                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keycloak | Local OIDC login (admin console: http://localhost:8080, `admin` / `admin`).                                                                                                                                                                                                                                    |
| seed     | Loads the story below into an empty database. It does nothing if data already exists, so restarts keep your changes.                                                                                                                                                                                           |
| demo-llm | An offline, OpenAI-compatible **stand-in** for an LLM at `http://demo-llm:4010/v1`, which alice connects in Admin → AI & models. It uses deterministic embeddings and templated replies, so it isn't a real model, but search, Ask Scry, drafting and overlap detection all behave realistically on this data. |

**Reset to a fresh demo:** run the same command with `down -v`, then `up -d`
again. That also forgets the AI settings, so connect the demo LLM again
(natively, `SEED_RESET=true` does the same). Changes to the demo logins in
`infra/docker/keycloak/realm-export.json` also need `down -v`: the realm is
only imported on Keycloak's first boot.

<details>
<summary>Running natively instead (pnpm dev)</summary>

```bash
cp .env.keycloak.example .env
docker compose -f infra/docker/docker-compose.yml \
               -f infra/docker/docker-compose.keycloak.yml up -d
pnpm install
pnpm --filter @scry/db db:migrate
pnpm --filter @scry/db db:seed        # SEED_RESET=true to wipe and reseed
pnpm demo:llm &                       # the offline demo LLM on :4010
pnpm dev
```

In step 0, the base URL is `http://localhost:4010/v1` (the api runs on
your machine, not in Docker). After reseeding while the api is running,
restart it (or press **Re-index** in AI & models): it indexes unembedded
initiatives on startup.

</details>

## Logins

All passwords follow the pattern `<username>123`.

| Username | Password   | Person       | Team                | Role       | Start here to see…                                                                      |
| -------- | ---------- | ------------ | ------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `alice`  | `alice123` | Alice Chen   | _none_              | Admin      | Everything: approving new teams, filing work for any owner, the audit log, AI settings. |
| `dan`    | `dan123`   | Daniel Kim   | Payments Platform   | Team admin | Payments' work, a registered-from-chat initiative, and demand for dark mode.            |
| `bob`    | `bob123`   | Bob Martinez | Growth              | Team admin | The headline duplicate, work on hold, a merge, and letting new people into Growth.      |
| `sam`    | `sam123`   | Sam Okafor   | Growth              | Member     | An ordinary member: the contact for Bob's pricing experiments.                          |
| `priya`  | `priya123` | Priya Shah   | Data & ML           | Team admin | The other side of the duplicate, Feature store, and Noah's request to join.             |
| `lena`   | `lena123`  | Lena Vogel   | Design Systems      | Team admin | Other teams building on her work, and a duplicate merged into her dark mode.            |
| `omar`   | `omar123`  | Omar Haddad  | Identity & Security | Team admin | Passkeys on hold, a dismissed "not a duplicate", and an old request that has faded.     |
| `carol`  | `carol123` | Carol Nguyen | _none yet_          | Member     | First visit: ask to join a team (or create one), and look around while waiting.         |
| `noah`   | _no login_ | Noah Fischer | _waiting_           | Member     | Asked to join Data & ML: his request is there for priya to decide.                      |
| `mia`    | _no login_ | Mia Lopez    | _waiting_           | Member     | Asked for a new team, _Customer Support Tools_, waiting for alice.                      |

**Roles.** The admin isn't in a team and sees everything. Each team has a
**team admin** who lets people in, removes members, gives team admin rights
and edits any of the team's initiatives, from the **Team** page. People who
are waiting to be let in can look around but not change anything.

You can sign in with the username or the email (`alice@example.com`, …).
Scry matches people to their seeded data by email.

## The story

A product org with five teams shares one Scry workspace. Each team plans in
its own tracker, and until now nobody could see what the others were
committing to. This is what's going on:

1. **Two teams are about to build the same thing.** Growth (Bob) registered
   _Customer analytics dashboards for account managers_ two days ago. Data &
   ML (Priya) already planned _Self-serve customer analytics dashboards_ for
   the same people. Scry flagged it as an **87% overlap** and notified both.
   The two have started talking in the comments, but nobody has decided yet.
   A week earlier, Bob **merged** Growth's own _Dark theme for the marketing
   site_ into Design Systems' _Dark mode everywhere_ when Scry flagged that
   pair.
2. **Other teams want work nobody has picked up.** _Dark mode everywhere_ is
   still an idea, but Growth and Payments both said they need it. _Feature
   store_ is wanted by Payments and Growth (both build on it) and hasn't been
   touched for seven weeks.
3. **Work is on hold, and other teams build on it.** Identity's _Passkeys for
   customer login_ is **on hold** until Enterprise SSO's session service is
   ready. Growth's _Referral program v2_ builds on passkeys, so it's on hold
   too. Bob follows passkeys, which is how he found out.
4. **One idea went through Ask Scry the right way.** Dan (Payments) described
   "fraud risk scoring when onboarding new merchants". Scry found Identity's
   _Account takeover risk scoring_: related, but a different problem. He
   registered _Merchant fraud risk scoring_, noted that it builds on Data &
   ML's _Feature store_, and marked the takeover match as not related. When
   overlap detection later flagged the two anyway, Omar dismissed it.

Relationships in Scry only connect **different teams** and say who should
know about whose work: _builds on_, _replaces_ and _related_. They never say
what waits on what; that stays in each team's delivery tool.

Behind these: 22 initiatives across all statuses (one merged duplicate),
8 relationships between teams, three teams starting on analytics separately,
dated work on the timeline, comment threads, history, follows, "we need this
too" with reasons (one asked 8 months ago and never confirmed, so it fades),
an audit log, API tokens, and an inbox for everyone.

| Team                | Initiatives                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments Platform   | Event-driven payments ledger _(gone quiet)_ · Unified checkout SDK (builds on Component library 3.0) · Refund automation _(shipped)_ · Merchant fraud risk scoring (builds on Feature store) · Merchant analytics export                                |
| Growth              | Referral program v2 _(on hold, builds on Passkeys)_ · Customer analytics dashboards for account managers _(the duplicate)_ · Lifecycle email revamp · Marketing site component kit · Pricing page experiments · Marketing brand style guide _(shipped)_ |
| Data & ML           | Self-serve customer analytics dashboards · Churn prediction model · Feature store _(gone quiet, two teams build on it)_                                                                                                                                 |
| Design Systems      | Component library 3.0 · Design tokens _(shipped, replaced Growth's style guide)_ · Dark mode everywhere _(an idea two teams want)_                                                                                                                      |
| Identity & Security | Enterprise SSO (SAML + OIDC) · Passkeys for customer login _(on hold)_ · Legacy auth service upgrade _(cancelled)_ · Account takeover risk scoring                                                                                                      |

## Walkthrough

Start with step 0; after that, each step names the feature it shows and the
steps work in any order.

Everyone gets a one-minute guided tour on their first visit. Take it, or
skip it and replay it later from **Help** (the **?** button, top right).

### 0. Switch on the AI: **alice**

Out of the box nothing is connected: alice sees a _No AI model connected_
bar, and everyone else is told in Ask Scry that an admin needs to connect
one.

1. Click **Set up AI** (or Admin → **AI & models**).
2. Base URL: click the **Demo LLM** preset (`http://demo-llm:4010/v1`).
   Authentication: **No authentication**.
3. Models: leave the defaults. The demo LLM answers to any model name;
   against a real gateway, these are its model names.
4. **Test connection:** all three roles should come back green, with
   embeddings reporting _1536-dimensional vectors_.
5. **Save.** The progress bar indexes all 22 initiatives in a few seconds,
   and AI features switch on for everyone.

Also on this page: per-role models, the embedding vector size, the match
and overlap thresholds, usage attribution, and a **Usage** panel (calls,
failures, latency and tokens per role) that fills in as people use Scry. To
try the other auth modes, see [Trying the AI auth modes](#trying-the-ai-auth-modes).

### 1. Resolve the duplicate: sign in as **bob**

- **Inbox:** the bell has unread notifications, including _Possible overlap
  (87%)_ and Priya's comment. Click the overlap notification.
- **Overlap review:** the detail panel shows the overlap card, with three
  ways to resolve it. Each one clears the _possible overlaps to review_
  banner on **Initiatives**:
  - **Related, not the same** keeps both and records that the two teams
    should know about each other.
  - _Not a duplicate_ dismisses it.
  - **Merge into it** folds Bob's duplicate into Priya's. The dialog says
    what moves (the target is the flagged pair; only flagged duplicates
    can be merged), and since Priya's initiative isn't Bob's, the button reads
    **Ask to merge**: Bob's initiative shows _Waiting to be merged_ with
    **Withdraw**. Sign in as `priya`: the bell says Bob asks to merge, and
    her initiative shows **Merge** / **Decline**. After **Merge**, Bob's
    initiative shows _Merged — work continues in…_ with its discussion
    intact, Priya's shows Growth under _Also needed by_, and both teams get
    a notification. (As `alice`, an admin, the merge happens at once.)
- **Discussion and history:** in the other initiative, _Self-serve customer
  analytics dashboards_, read the thread with Priya and Dan, then open the
  **History** tab.
- **Timeline:** in **Timeline**, both dashboard projects are marked
  _overlapping in time_, because their dates collide as well as their
  content.

### 2. Work on hold, and who builds on it: still as **bob**

- Open _Referral program v2_. It's **on hold**, with the reason under its
  title, and under _Other teams' work_ it **builds on** _Passkeys for
  customer login_. Open passkeys to see why that is on hold too.
- **Add a relationship:** from any Growth initiative, **Add** under _Other
  teams' work_ only offers other teams' initiatives. Relating two of
  Growth's own initiatives is refused: inside a team, people just talk.
- **Graph:** it opens on the whole organisation, one circle per team,
  already open at the demo's size. Zoom out and the teams close into
  circles with a status ring; hover one, or a line between two, to read it.
  Click a team (or pick Growth under **Or go to a team…**) to zoom to it.
  Type "Passkeys" in **Go to an initiative…** to jump to it; hovering an
  initiative highlights what it's related to. With AI on, search
  "passwordless login" and the map frames the teams with matches.

### 3. Check an idea before building it: any user

Open **Ask Scry** in the sidebar (or type a question into **Jump to… / ⌘K**
and pick _Ask Scry_), then try the suggested prompts. Each shows a
different outcome:

| Prompt                                                                     | What happens                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Passwordless login for customers using passkeys_                          | **Strong match:** it's Identity's passkeys work. Scry names the team and contact (Omar Haddad) and suggests talking to him first.                                                     |
| _Dashboards so account managers can explore customer analytics themselves_ | **Strong match** with both dashboard initiatives.                                                                                                                                     |
| _Fraud risk scoring when onboarding new merchants_                         | **Weak match:** related to Merchant fraud risk scoring but not identical. Register it, then mark each piece of evidence as related, or dismiss it.                                    |
| _Carbon footprint reporting for business customers_                        | **No match:** click **Register this idea**. Scry drafts the title, summary and tags; edit them and save. Then check **Initiatives**: it's there, marked _Indexing_ for a few seconds. |

Answers stream in as the model writes them. Ask Scry is an agent with tools: say _Hi_ and it
asks for an idea without searching; describe one and it searches (you see
"Searching for …" while it works, and "Searched for …" under the answer);
ask _Who should I talk to?_ and it looks the initiative up instead of
searching again; say _just register it_ and it offers **Register this
idea**. After registering, it won't offer again. The sidebar also has finished
conversations: Dan's (registered), Bob's (a strong match), Omar's (found
Growth's referral programme through a relationship, not the words) and
Priya's (no match, not registered yet).

### 4. Your own work, your own inbox: **priya**, **lena**, **omar**

- **priya:** the overlap notification from Data & ML's side, and a comment
  from Bob. Settings → **Following** shows she follows the `analytics` tag.
- **lena:** notifications that other teams now **build on** her _Component
  library 3.0_, that Growth's dark theme was **merged** into her _Dark mode
  everywhere_, and that Payments needs it too. Open Data & ML's _Feature
  store_: Payments and Growth already said they need it (_Also needed by_).
  Click **We need this too**, give a reason (it's required), and the
  table's badge goes to 3 while Priya is notified.
- **omar:** open _Merchant fraud risk scoring_ (Payments): the History tab
  shows the overlap he **dismissed**, and his comment explains why. Then
  open _Component library 3.0_: his request from 8 months ago is faded,
  with **Still needed** to confirm it.
- **sam:** Growth's second member. _Pricing page experiments_ was submitted
  by Bob with Sam as the contact, so either can edit it; in **New
  initiative**, Growth's contact person is now a real choice.

### 5. Administer and import: **alice**

- **Setup checklist:** the top of Admin lists what a fresh install still
  needs (AI, roadmap, people, teams, a second admin) with a button for each.
  Hide it once you've seen it; it goes away by itself when everything's done.
- **New teams:** Admin → Teams → _New teams waiting for approval_ shows
  Mia's _Customer Support Tools_. **Approve** makes it a team with Mia as its
  team admin. Below it, _Requests to join a team_ lists Noah's request to
  Data & ML: team admins decide their own, and you can step in.
- **Admin:** move people between teams, make someone a team admin, change
  roles, create or rename teams (org unit and country are chosen from
  `ORG_UNITS` and `COUNTRIES` in `.env`), or **merge** two teams. **Open**
  on a team shows its Team page.
- **Filing work for someone:** you're not in a team, so **New initiative**
  asks for an **Owner**: search anyone, and it goes to their team with them
  as the contact.
- **Import:** Admin → _Import initiatives_ (or **Import** on the Initiatives
  page). Download the template, or drop a Jira CSV export. The preview shows
  row-level problems before anything is created.
- **Settings → Following:** Alice follows the `fraud` tag and the Identity &
  Security team, which is why _Account takeover risk scoring_ appears in her
  inbox.
- **Settings → API tokens:** create a token for a script: read only unless
  you pick _Read and write_.
- **Admin → AI tools:** **Turn on** lets people ask Scry from their AI tools
  (MCP). Then, as any user, Settings → _AI tools_ shows the address and the
  Claude Code command. Connecting opens Scry's consent page (_Allow read
  access_); afterwards the tool is listed with **Disconnect**, and Admin →
  AI tools shows each call.
- **Admin → Audit log:** every change above (roles, team moves, renames,
  merges, team admins, requests to join, new teams, AI settings, tokens,
  imports) with who and when. Filter by kind and expand an entry for detail;
  credentials never appear.

### 5a. Run a team: **bob** or **priya**

- The sidebar's **Team** entry (team admins only) shows how many people are
  waiting. As priya, Noah Fischer is asking to join Data & ML: **Let in** or
  **Decline**.
- **Members:** make someone a team admin, take it back, or remove them. A
  team keeps at least one team admin while it has members.
- **Team audit log:** who asked to join, who was let in or removed, who got
  team admin rights (as bob: Sam asking to join Growth and Bob letting him
  in).
- A team admin can edit any of the team's initiatives: as bob, edit Sam's
  _Pricing page experiments_.

### 5b. The leadership brief: any user

Open **Brief** in the sidebar. It's a one-page read for a CIO or strategy
lead on what needs a decision, not a delivery report:

- **The summary** at the top is written by Scry from the figures, so it
  works without AI. With AI connected, **Reword with AI** rewrites it (each
  point links to the initiatives it's about); **Use the plain summary** puts
  it back.
- **Decisions for you** (at most five), each naming who to talk to: the
  dashboards duplicate, _Dark mode everywhere_ (wanted by two teams, still
  an idea), _Feature store_ (gone quiet while two teams build on it),
  _Passkeys_ (on hold while Growth builds on it) and the quiet _payments
  ledger_.
- **Most wanted:** demand from teams that asked and teams that build on the
  work, one voice per team, with their reasons. Omar's old request fades and
  isn't counted.
- **What's emerging:** three teams started on analytics separately.
- **What changed:** the merge, new demand, work that moved forward or
  shipped.
- **The numbers:** one line of totals and a small table by team.
- Switch the period (30 days to all time) and the **scope** (an org unit
  such as _Security_). Both are in the URL, and can be kept as a saved view.
- **Print or save PDF** gives a clean A4 document in either theme. **Copy as
  text** gives a version for email or chat.

### 6. Onboarding: **carol**

Carol has no team yet. She can **ask to join** a team, or **create a team**
(its org unit and country come from the organisation's list). Either way
she's let in to look around with a banner saying what she's waiting for,
and can't register, comment or edit until then; **Withdraw** lets her choose
again. As bob, open **Team** and **Let in** Carol's request to Growth; her
banner goes when she reloads. Once she's in, only an admin can move her.

### 7. Everything else

- **New initiative** (top of the sidebar, or press **C**):
  - **Draft with AI:** describe the idea in your own words (try "Account
    managers can't see which customers are about to churn until it's too
    late. We want a weekly churn risk list for account managers, so they can
    call at-risk customers before renewal.") and **Draft** fills in the
    title, summary, tags (reusing existing ones such as `churn`) and tier.
    **Undo** puts the form back.
  - **Suggest improvements** reviews what you wrote: it shows whether the
    summary says what it is, who it's for and why it matters, and proposes
    edits you accept one at a time.
  - Start typing "Passwordless login … passkeys" and the form warns that
    _Passkeys for customer login_ may already exist, with its team, status
    and contact.
- **⌘K / Ctrl+K:** jump to any initiative, team or view, or start _New
  initiative_. Anything you type can also go to Ask Scry as a question.
- **TL;DR:** every initiative's details panel opens with a one-line,
  AI-written TL;DR (the table and board show it too). Open _Passkeys for
  customer login_: it's on hold until Enterprise SSO's session service is
  ready, and Referral program v2 builds on it. Mark _Referral program v2_
  shipped as alice and the passkeys TL;DR drops it a few seconds later.
- **Shareable links:** filters, the selected initiative, the board grouping
  and the open chat are all in the URL.
- **Board drag and drop:** drag a card you own to another status lane (or,
  as an admin grouped by team, to another team). **Undo** is in the toast.
  With a card focused, **Alt+←/→** does the same from the keyboard.
- **Sorting:** click **Initiative**, **Status**, **Target** or **Updated**
  on the Initiatives page to sort (click again to reverse). The order is in
  the link, like the filters. Long lists load 50 at a time.
- **Saved views:** filter the Initiatives page (say, status _On hold_), then
  **Views → Save**. It appears under _Saved views_ in the sidebar. The rows
  icon next to it switches between comfortable and compact rows.
- **Resizable details panel:** drag its left edge; double-click to reset.
- **Light / dark:** the theme toggle next to your name, or Settings →
  Appearance.
- **Mobile:** narrow the window; navigation becomes a drawer and the detail
  panel goes full-screen.

## Trying the AI auth modes

The demo LLM can require credentials, so each of Scry's auth modes can be
tried offline. Add to `.env`, then recreate it with the demo command plus
`up -d demo-llm`:

```bash
DEMO_LLM_API_KEY=demo-key
DEMO_LLM_JWKS_URL=http://api:3001/.well-known/jwks.json,http://keycloak:8080/realms/scry/protocol/openid-connect/certs
```

From then on, unauthenticated calls fail. **Test connection** shows the
reason for each role. In Admin → AI & models, as alice:

| Mode                   | Settings                                                                                                                     | Expect                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **API key**            | Key `demo-key`, header `Authorization`                                                                                       | Green. A wrong key fails with _Invalid API key_. Saved keys show as _stored_, never the value.               |
| **JWT from your IdP**  | Token URL `http://keycloak:8080/realms/scry/protocol/openid-connect/token`, client `scry-llm`, secret `scry-llm-demo-secret` | Green. Keycloak issues the token and the demo LLM checks it against Keycloak's keys.                         |
| **JWT signed by Scry** | Click **Generate key**. Audience `litellm`                                                                                   | Green. The demo LLM checks Scry's own JWKS. **Rotate key** keeps working (the old key signs for 10 minutes). |

The `scry-llm` Keycloak client is only imported on Keycloak's first boot, so
an existing demo needs `down -v` first.

Against a real **LiteLLM**, API keys (virtual or master keys) work as-is.
LiteLLM's JWT auth is an Enterprise feature: it refuses JWTs unless
`LITELLM_LICENSE` is set, so the JWT modes need a licensed (or trial)
LiteLLM, configured with `enable_jwt_auth: True` and `JWT_PUBLIC_KEY_URL`
pointing at the keys (Scry's JWKS URL is shown on the AI page).

## AI tools and scripts

As alice, **Admin → AI tools → Turn on**. Then, as any demo user:

```bash
# Claude Code: the first call opens Scry's consent page (sign in, Allow read access)
claude mcp add --transport http scry http://localhost:3001/mcp
```

Ask it "is anyone working on churn prediction?" or "what is Growth working
on?". Settings → _AI tools_ lists it with **Disconnect**, and Admin → AI
tools shows each call.

Scripts use a token from Settings → API tokens (read only by default):

```bash
TOKEN=scry_pat_…
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3001/initiatives?search=dashboards"
curl -s http://localhost:3001/mcp -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_initiatives","arguments":{"query":"dashboards"}}}'
```

The full REST API is described at http://localhost:3001/docs.

## Using a real LLM instead

As alice, in Admin → **AI & models**, point the base URL at your gateway or
provider, for example a LiteLLM gateway at `http://litellm:4000/v1`. Choose
how Scry authenticates, set real model names per role (and _Dims_ to your
embedding model's size, which Test connection can detect), test, and save.
Because the embedding model changes, saving re-indexes every initiative.
Real similarity scores differ from the demo's, so revisit the thresholds
under **Matching**.
