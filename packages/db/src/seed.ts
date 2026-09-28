/**
 * Demo seed — a small product org whose data tells a story that touches
 * every Scry feature. See docs/demo.md for the story, the walkthrough, and
 * the demo logins (which live in infra/docker/keycloak/realm-export.json).
 *
 *   pnpm --filter @scry/db db:seed              # seeds an empty database
 *   SEED_RESET=true pnpm --filter @scry/db db:seed   # wipes all data (and AI settings) first
 *
 * Dates are relative to "now", so the timeline always looks current.
 * Embeddings are left empty on purpose: the API embeds every unindexed
 * initiative on boot (and runs overlap detection) once LLM_BASE_URL is set.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import { createDb, type Db } from "./client";
import {
  activity,
  auditLog,
  chatMessages,
  chatSessions,
  comments,
  edges,
  initiativeSignals,
  overlaps as initiativeOverlaps,
  initiatives,
  notifications,
  personalAccessTokens,
  subscriptions,
  teamJoinRequests,
  teams,
  users,
  type ChatMessageEvidence,
} from "./schema";

const DAY = 86_400_000;
const now = Date.now();
/** A timestamp `days` days ago (negative = in the future), optionally minus hours. */
const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * 3_600_000);
/** A YYYY-MM-DD date `days` from today (negative = in the past). */
const day = (days: number) => new Date(now + days * DAY).toISOString().slice(0, 10);

type Status = (typeof initiatives.$inferInsert)["status"];
type EdgeType = (typeof edges.$inferInsert)["type"];

// ----------------------------------------------------------------- people

const TEAMS = [
  { key: "payments", name: "Payments Platform", orgUnit: "Engineering", country: "DE" },
  { key: "growth", name: "Growth", orgUnit: "Marketing", country: "US" },
  { key: "data", name: "Data & ML", orgUnit: "Engineering", country: "UK" },
  { key: "design", name: "Design Systems", orgUnit: "Product", country: "NL" },
  { key: "identity", name: "Identity & Security", orgUnit: "Security", country: "DE" },
] as const;
type TeamKey = (typeof TEAMS)[number]["key"];

// Emails and names match the Keycloak demo realm, so signing in there lands
// on these rows (users are matched by email on login).
const PEOPLE = [
  // Alice is the admin: not in a team, she sees and runs everything.
  { key: "alice", name: "Alice Chen", team: null, role: "admin", employeeId: "E-1001" },
  // Each team is run by a team admin, who lets people in.
  {
    key: "dan",
    name: "Daniel Kim",
    team: "payments",
    role: "member",
    teamAdmin: true,
    employeeId: "E-1008",
  },
  {
    key: "bob",
    name: "Bob Martinez",
    team: "growth",
    role: "member",
    teamAdmin: true,
    employeeId: "E-1002",
  },
  // A second Growth member, so contact choices and "contact isn't the
  // submitter" come up (Sam is the contact for Bob's pricing experiments).
  { key: "sam", name: "Sam Okafor", team: "growth", role: "member", employeeId: "E-1007" },
  {
    key: "priya",
    name: "Priya Shah",
    team: "data",
    role: "member",
    teamAdmin: true,
    employeeId: "E-1004",
  },
  {
    key: "lena",
    name: "Lena Vogel",
    team: "design",
    role: "member",
    teamAdmin: true,
    employeeId: "E-1005",
  },
  {
    key: "omar",
    name: "Omar Haddad",
    team: "identity",
    role: "member",
    teamAdmin: true,
    employeeId: "E-1006",
  },
  // Carol has no team on purpose: she walks through onboarding live.
  { key: "carol", name: "Carol Nguyen", team: null, role: "member", employeeId: "E-1003" },
  // No logins: Noah is waiting to join Data & ML, Mia for her new team.
  { key: "noah", name: "Noah Fischer", team: null, role: "member", employeeId: "E-1009" },
  { key: "mia", name: "Mia Lopez", team: null, role: "member", employeeId: "E-1010" },
] as const;
type PersonKey = (typeof PEOPLE)[number]["key"];

// ------------------------------------------------------------ initiatives

interface InitiativeSpec {
  key: string;
  team: TeamKey;
  owner: PersonKey;
  /** Contact person, when it isn't the submitter. */
  contact?: PersonKey;
  title: string;
  summary: string;
  status: Status;
  tier: "strategic" | "tactical";
  start?: number;
  target?: number;
  tags: string[];
  link?: string;
  holdReason?: string;
  createdDaysAgo: number;
  /** Last touched this long ago (default: within the last few days). Over 45 = gone quiet. */
  quietDays?: number;
}

const INITIATIVES: InitiativeSpec[] = [
  // --- Payments Platform (Alice)
  {
    key: "ledger",
    team: "payments",
    owner: "dan",
    title: "Event-driven payments ledger",
    summary:
      "Move the payments ledger to an append-only event log so reconciliation runs continuously instead of as a nightly batch job.",
    status: "in_progress",
    tier: "strategic",
    start: -75,
    target: 60,
    tags: ["ledger", "kafka", "reliability"],
    link: "https://jira.example.com/browse/PAY-120",
    createdDaysAgo: 120,
    // Strategic and untouched for two months: "gone quiet" in the brief.
    quietDays: 58,
  },
  {
    key: "checkout",
    team: "payments",
    owner: "dan",
    title: "Unified checkout SDK",
    summary:
      "One embeddable checkout for web and mobile, replacing three divergent checkout implementations.",
    status: "planned",
    tier: "strategic",
    start: 20,
    target: 150,
    tags: ["checkout", "sdk"],
    createdDaysAgo: 40,
  },
  {
    key: "refunds",
    team: "payments",
    owner: "dan",
    title: "Refund automation",
    summary:
      "Auto-approve low-risk refunds under a threshold so support stops approving them by hand.",
    status: "shipped",
    tier: "tactical",
    start: -160,
    target: -30,
    tags: ["refunds", "support"],
    createdDaysAgo: 170,
    quietDays: 30,
  },
  {
    key: "merchantRisk",
    team: "payments",
    owner: "dan",
    title: "Merchant fraud risk scoring",
    summary:
      "Score new merchants for fraud risk during onboarding, using their transaction history and business details.",
    status: "in_progress",
    tier: "strategic",
    start: -20,
    target: 90,
    tags: ["fraud", "risk", "onboarding"],
    createdDaysAgo: 21,
  },
  {
    key: "merchantAnalytics",
    team: "payments",
    owner: "dan",
    title: "Merchant analytics export",
    summary:
      "Let merchants export their payment analytics to their own BI tools, so account managers stop building spreadsheets for them.",
    status: "idea",
    tier: "tactical",
    tags: ["analytics", "merchants"],
    createdDaysAgo: 10,
  },
  // --- Growth (Bob)
  {
    key: "referral",
    team: "growth",
    owner: "bob",
    title: "Referral program v2",
    summary:
      "Two-sided referral rewards with fraud checks and passwordless sign-up for invited friends.",
    status: "on_hold",
    tier: "strategic",
    start: -15,
    target: 70,
    tags: ["referrals", "growth"],
    holdReason: "Invited friends need passwordless sign-up, which comes with passkeys",
    createdDaysAgo: 35,
  },
  {
    key: "growthDashboards",
    team: "growth",
    owner: "bob",
    title: "Customer analytics dashboards for account managers",
    summary:
      "Self-serve dashboards so account managers can explore customer analytics themselves, without waiting on the data team.",
    status: "idea",
    tier: "tactical",
    start: 30,
    target: 130,
    tags: ["analytics", "dashboards"],
    createdDaysAgo: 2,
  },
  {
    key: "email",
    team: "growth",
    owner: "bob",
    title: "Lifecycle email revamp",
    summary: "Rebuild onboarding and win-back emails on the new templating service.",
    status: "in_progress",
    tier: "tactical",
    start: -40,
    target: 35,
    tags: ["email", "lifecycle"],
    createdDaysAgo: 50,
  },
  {
    key: "marketingKit",
    team: "growth",
    owner: "bob",
    title: "Marketing site component kit",
    summary:
      "Reusable React components and design tokens for the marketing website, accessible and themeable.",
    status: "planned",
    tier: "tactical",
    start: 10,
    target: 60,
    tags: ["react", "website"],
    createdDaysAgo: 25,
  },
  {
    key: "pricing",
    team: "growth",
    owner: "bob",
    contact: "sam",
    title: "Pricing page experiments",
    summary: "Test new pricing page layouts and plan names.",
    status: "idea",
    tier: "tactical",
    tags: ["pricing"],
    createdDaysAgo: 12,
  },
  {
    // Merged into Design Systems' "Dark mode everywhere" (see below).
    key: "darkThemeSite",
    team: "growth",
    owner: "bob",
    title: "Dark theme for the marketing site",
    summary: "A dark theme for the marketing website, which visitors keep asking for.",
    status: "idea",
    tier: "tactical",
    tags: ["website", "design-system"],
    createdDaysAgo: 14,
  },
  {
    // Replaced by Design Systems' tokens: the only "replaces" in the demo.
    key: "styleGuide",
    team: "growth",
    owner: "bob",
    title: "Marketing brand style guide",
    summary:
      "Colours, type and spacing rules for the marketing website, kept in a shared document.",
    status: "shipped",
    tier: "tactical",
    start: -420,
    target: -380,
    tags: ["website", "brand"],
    createdDaysAgo: 430,
    quietDays: 190,
  },
  // --- Data & ML (Priya)
  {
    key: "dataDashboards",
    team: "data",
    owner: "priya",
    title: "Self-serve customer analytics dashboards",
    summary:
      "Self-serve dashboards on the data warehouse so account managers can explore customer analytics themselves.",
    status: "planned",
    tier: "strategic",
    start: 15,
    target: 160,
    tags: ["analytics", "dashboards", "warehouse"],
    createdDaysAgo: 30,
  },
  {
    key: "churn",
    team: "data",
    owner: "priya",
    title: "Churn prediction model",
    summary:
      "Weekly churn-risk scores for every customer, surfaced to account managers in the CRM.",
    status: "in_progress",
    tier: "strategic",
    start: -30,
    target: 80,
    tags: ["ml", "churn"],
    createdDaysAgo: 45,
  },
  {
    key: "featureStore",
    team: "data",
    owner: "priya",
    title: "Feature store",
    summary: "A shared feature store so models train and serve on the same, versioned features.",
    status: "in_progress",
    tier: "tactical",
    start: -50,
    target: 40,
    tags: ["ml", "platform"],
    createdDaysAgo: 80,
    // Two other teams build on it and it hasn't moved in weeks: at risk.
    quietDays: 52,
  },
  // --- Design Systems (Lena)
  {
    key: "components",
    team: "design",
    owner: "lena",
    title: "Component library 3.0",
    summary:
      "Accessible, themeable React components built on the design tokens, for every product surface.",
    status: "in_progress",
    tier: "strategic",
    start: -45,
    target: 55,
    tags: ["react", "a11y", "design-system"],
    createdDaysAgo: 280,
  },
  {
    key: "tokens",
    team: "design",
    owner: "lena",
    title: "Design tokens",
    summary: "Cross-platform design tokens shared by web, iOS and Android.",
    status: "shipped",
    tier: "strategic",
    start: -180,
    target: -45,
    tags: ["design-system", "a11y"],
    createdDaysAgo: 200,
    quietDays: 45,
  },
  {
    key: "darkMode",
    team: "design",
    owner: "lena",
    title: "Dark mode everywhere",
    summary: "Ship dark mode across every customer-facing surface.",
    status: "idea",
    tier: "tactical",
    tags: ["design-system"],
    createdDaysAgo: 8,
  },
  // --- Identity & Security (Omar)
  {
    key: "sso",
    team: "identity",
    owner: "omar",
    title: "Enterprise SSO (SAML + OIDC)",
    summary: "SAML and OIDC single sign-on for enterprise customers, with SCIM user provisioning.",
    status: "in_progress",
    tier: "strategic",
    start: -30,
    target: 50,
    tags: ["sso", "enterprise"],
    createdDaysAgo: 55,
  },
  {
    key: "passkeys",
    team: "identity",
    owner: "omar",
    title: "Passkeys for customer login",
    summary: "Passwordless login for customers using passkeys instead of passwords.",
    status: "on_hold",
    holdReason: "Paused until Enterprise SSO's new session service is ready",
    tier: "tactical",
    start: 0,
    target: 75,
    tags: ["passkeys", "webauthn"],
    createdDaysAgo: 40,
  },
  {
    key: "legacyAuth",
    team: "identity",
    owner: "omar",
    title: "Legacy auth service upgrade",
    summary: "Upgrade the v1 auth service to a supported framework version.",
    status: "cancelled",
    tier: "tactical",
    start: -300,
    target: -120,
    tags: ["auth"],
    createdDaysAgo: 320,
    quietDays: 54,
  },
  {
    key: "ato",
    team: "identity",
    owner: "omar",
    title: "Account takeover risk scoring",
    summary:
      "Score customer logins for account takeover risk using device, location and velocity signals.",
    status: "planned",
    tier: "tactical",
    start: 40,
    target: 120,
    tags: ["fraud", "risk", "security"],
    createdDaysAgo: 18,
  },
];

// Human-confirmed relationships between teams: [from, type, to, who, daysAgo].
// They say who should know about whose work, never what waits on what, and
// always cross a team boundary.
const EDGES: [string, EdgeType, string, PersonKey, number][] = [
  ["checkout", "builds_on", "components", "dan", 37],
  ["email", "builds_on", "components", "bob", 45],
  ["referral", "builds_on", "passkeys", "bob", 30],
  ["merchantRisk", "builds_on", "featureStore", "dan", 20],
  ["email", "builds_on", "featureStore", "bob", 15],
  // Resolved overlap: Growth's kit now builds on Design Systems' library.
  ["marketingKit", "builds_on", "components", "bob", 22],
  ["tokens", "replaces", "styleGuide", "lena", 190],
  ["darkMode", "related", "marketingKit", "lena", 7],
];

// ---------------------------------------------------------------- helpers

async function resetAll(db: Db) {
  await db.execute(
    dsql`truncate table teams, users, initiatives, edges, chat_sessions, chat_messages,
      personal_access_tokens, activity, comments, initiative_overlaps, notifications,
      subscriptions, initiative_signals, audit_log, llm_calls, llm_settings,
      app_settings, oauth_clients, mcp_calls
      restart identity cascade`,
  );
}

const titleOf = (spec: InitiativeSpec) => spec.title;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { db, sql } = createDb(databaseUrl);

  try {
    const [{ count }] = (await db.execute(
      dsql`select count(*)::int as count from teams`,
    )) as unknown as [{ count: number }];
    if (count > 0) {
      if (process.env.SEED_RESET !== "true") {
        console.log(
          "Database already has data — skipping the demo seed. Set SEED_RESET=true to wipe it and reseed.",
        );
        return;
      }
      console.log("SEED_RESET=true — wiping all data before seeding.");
      await resetAll(db);
    }

    // --- teams & people
    const teamRows = await db
      .insert(teams)
      .values(
        TEAMS.map((t) => ({
          name: t.name,
          orgUnit: t.orgUnit,
          country: t.country,
          createdAt: ago(365),
          updatedAt: ago(365),
        })),
      )
      .returning();
    const teamId = Object.fromEntries(TEAMS.map((t, i) => [t.key, teamRows[i]!.id])) as Record<
      TeamKey,
      string
    >;

    const userRows = await db
      .insert(users)
      .values(
        PEOPLE.map((p) => ({
          name: p.name,
          email: `${p.key}@example.com`,
          employeeId: p.employeeId,
          role: p.role,
          teamId: p.team ? teamId[p.team] : null,
          teamAdmin: "teamAdmin" in p && p.teamAdmin,
          createdAt: ago(p.key === "carol" ? 0 : p.key === "noah" || p.key === "mia" ? 2 : 300),
          updatedAt: ago(p.key === "carol" ? 0 : p.key === "noah" || p.key === "mia" ? 2 : 300),
        })),
      )
      .returning();
    const userId = Object.fromEntries(PEOPLE.map((p, i) => [p.key, userRows[i]!.id])) as Record<
      PersonKey,
      string
    >;

    // --- initiatives + graph nodes + "created" history
    const spec = Object.fromEntries(INITIATIVES.map((i) => [i.key, i]));
    const rows = await db
      .insert(initiatives)
      .values(
        INITIATIVES.map((i) => ({
          title: i.title,
          summary: i.summary,
          status: i.status,
          tier: i.tier,
          teamId: teamId[i.team],
          submittedBy: userId[i.owner],
          contactPerson: userId[i.contact ?? i.owner],
          startDate: i.start !== undefined ? day(i.start) : null,
          targetDate: i.target !== undefined ? day(i.target) : null,
          tags: i.tags,
          externalLink: i.link ?? null,
          holdReason: i.holdReason ?? null,
          createdAt: ago(i.createdDaysAgo),
          updatedAt: ago(i.quietDays ?? Math.max(0, Math.min(i.createdDaysAgo, 3)), 2),
        })),
      )
      .returning();
    const id = Object.fromEntries(INITIATIVES.map((i, idx) => [i.key, rows[idx]!.id]));

    const history: (typeof activity.$inferInsert)[] = INITIATIVES.map((i) => ({
      initiativeId: id[i.key]!,
      actorId: userId[i.owner],
      kind: i.key === "merchantRisk" ? ("registered_from_chat" as const) : ("created" as const),
      data: {},
      createdAt: ago(i.createdDaysAgo),
    }));
    const log = (
      key: string,
      actor: PersonKey | null,
      kind: (typeof activity.$inferInsert)["kind"],
      data: Record<string, unknown>,
      daysAgo: number,
      hours = 0,
    ) =>
      history.push({
        initiativeId: id[key]!,
        actorId: actor ? userId[actor] : null,
        kind,
        data,
        createdAt: ago(daysAgo, hours),
      });

    // --- explicit relationships with history on both ends
    for (const [from, type, to, who, daysAgo] of EDGES) {
      const [edge] = await db
        .insert(edges)
        .values({
          fromInitiativeId: id[from]!,
          toInitiativeId: id[to]!,
          type,
          createdBy: userId[who],
          createdAt: ago(daysAgo),
        })
        .returning();
      log(
        from,
        who,
        "edge_added",
        {
          edgeId: edge!.id,
          type,
          direction: "outgoing",
          otherInitiativeId: id[to],
          otherTitle: titleOf(spec[to]!),
        },
        daysAgo,
      );
      log(
        to,
        who,
        "edge_added",
        {
          edgeId: edge!.id,
          type,
          direction: "incoming",
          otherInitiativeId: id[from],
          otherTitle: titleOf(spec[from]!),
        },
        daysAgo,
      );
    }

    // A relationship that was taken back: checkout first built on the tokens
    // directly, then on the component library instead.
    for (const [key, direction, other] of [
      ["checkout", "outgoing", "tokens"],
      ["tokens", "incoming", "checkout"],
    ] as const) {
      log(
        key,
        "dan",
        "edge_added",
        {
          type: "builds_on",
          direction,
          otherInitiativeId: id[other],
          otherTitle: titleOf(spec[other]!),
        },
        39,
      );
      log(
        key,
        "dan",
        "edge_removed",
        {
          type: "builds_on",
          direction,
          otherInitiativeId: id[other],
          otherTitle: titleOf(spec[other]!),
        },
        36,
      );
    }

    // --- status history: what's on hold, what moved forward, what shipped
    log("passkeys", "omar", "status_changed", { from: "planned", to: "on_hold" }, 4);
    log("referral", "bob", "status_changed", { from: "in_progress", to: "on_hold" }, 3);
    log("legacyAuth", "omar", "status_changed", { from: "in_progress", to: "cancelled" }, 54);
    log("refunds", "dan", "status_changed", { from: "in_progress", to: "shipped" }, 30);
    log("tokens", "lena", "status_changed", { from: "in_progress", to: "shipped" }, 45);
    log("styleGuide", "bob", "status_changed", { from: "in_progress", to: "shipped" }, 380);
    log("ato", "omar", "status_changed", { from: "idea", to: "planned" }, 12);
    log("checkout", "dan", "status_changed", { from: "idea", to: "planned" }, 33);
    log("email", "bob", "status_changed", { from: "planned", to: "in_progress" }, 40);
    log("churn", "priya", "updated", { fields: ["targetDate", "summary"] }, 6);

    // --- overlaps: one open (the demo's headline), one dismissed, one linked, one merged
    const pair = (a: string, b: string) => {
      const [x, y] = [id[a]!, id[b]!];
      return x < y
        ? { initiativeAId: x, initiativeBId: y }
        : { initiativeAId: y, initiativeBId: x };
    };
    await db.insert(initiativeOverlaps).values([
      {
        ...pair("growthDashboards", "dataDashboards"),
        score: 0.87,
        status: "open",
        createdAt: ago(2),
        updatedAt: ago(2),
      },
      {
        ...pair("merchantRisk", "ato"),
        score: 0.87,
        status: "dismissed",
        resolvedBy: userId.omar,
        createdAt: ago(17),
        updatedAt: ago(16),
      },
      {
        ...pair("marketingKit", "components"),
        score: 0.88,
        status: "linked",
        resolvedBy: userId.bob,
        createdAt: ago(24),
        updatedAt: ago(22),
      },
      {
        ...pair("darkThemeSite", "darkMode"),
        score: 0.91,
        status: "merged",
        resolvedBy: userId.bob,
        createdAt: ago(8),
        updatedAt: ago(6),
      },
    ]);
    for (const [a, b, score, daysAgo] of [
      ["growthDashboards", "dataDashboards", 0.87, 2],
      ["merchantRisk", "ato", 0.87, 17],
      ["marketingKit", "components", 0.88, 24],
      ["darkThemeSite", "darkMode", 0.91, 8],
    ] as const) {
      log(a, null, "overlap_detected", { otherInitiativeId: id[b], score }, daysAgo, -1);
      log(b, null, "overlap_detected", { otherInitiativeId: id[a], score }, daysAgo, -1);
    }

    // --- the merge: Bob folded Growth's dark theme into Design Systems' dark
    // mode once the overlap was flagged. The duplicate stays readable, marked
    // as merged, and Growth's need moves over as a "we need this too".
    await db
      .update(initiatives)
      .set({ status: "cancelled", mergedIntoId: id.darkMode!, mergedAt: ago(6), updatedAt: ago(6) })
      .where(dsql`${initiatives.id} = ${id.darkThemeSite!}`);
    log(
      "darkThemeSite",
      "bob",
      "merged_into",
      { otherInitiativeId: id.darkMode, otherTitle: spec.darkMode!.title },
      6,
    );
    log(
      "darkMode",
      "bob",
      "merged_from",
      {
        otherInitiativeId: id.darkThemeSite,
        otherTitle: spec.darkThemeSite!.title,
        otherTeam: "Growth",
        movedRelationships: 0,
      },
      6,
    );

    // --- discussion
    const thread: [string, PersonKey, string, number, number][] = [
      [
        "dataDashboards",
        "priya",
        "We're scoping the dashboard builder on the warehouse now — would love input on the metrics account managers need most.",
        9,
        0,
      ],
      [
        "dataDashboards",
        "dan",
        "Settlement latency and refund rates would cover most of Payments' questions.",
        8,
        3,
      ],
      [
        "dataDashboards",
        "priya",
        'Scry just flagged Growth\'s "Customer analytics dashboards" as an 87% match with this. Bob — same thing? Happy to build it together.',
        1,
        20,
      ],
      [
        "dataDashboards",
        "bob",
        "Yes — same need, I hadn't seen yours. Let's merge: we'll bring the account-manager requirements.",
        1,
        4,
      ],
      [
        "passkeys",
        "omar",
        "Putting this on hold until enterprise SSO ships — passkeys reuse its new session service.",
        4,
        1,
      ],
      [
        "passkeys",
        "bob",
        "Referral v2 builds on this for passwordless sign-up, so we've paused too. Any news on SSO?",
        3,
        5,
      ],
      [
        "merchantRisk",
        "omar",
        "Looked at the overlap flag with Account takeover scoring — different problem (merchants vs. customer logins), so I dismissed it. Worth sharing the feature pipeline though.",
        16,
        0,
      ],
      [
        "merchantRisk",
        "priya",
        "Agreed — both can train on the feature store. Alice added that merchant scoring builds on it.",
        15,
        0,
      ],
    ];
    await db.insert(comments).values(
      thread.map(([key, who, body, d, h]) => ({
        initiativeId: id[key]!,
        authorId: userId[who],
        body,
        createdAt: ago(d, h),
      })),
    );
    for (const [key, who, , d, h] of thread) log(key, who, "commented", {}, d, h);

    await db.insert(activity).values(history);

    // --- follows
    await db.insert(subscriptions).values([
      {
        userId: userId.bob,
        targetType: "initiative",
        targetValue: id.passkeys!,
        createdAt: ago(30),
      },
      { userId: userId.alice, targetType: "tag", targetValue: "fraud", createdAt: ago(60) },
      {
        userId: userId.alice,
        targetType: "team",
        targetValue: teamId.identity,
        createdAt: ago(60),
      },
      { userId: userId.priya, targetType: "tag", targetValue: "analytics", createdAt: ago(90) },
      { userId: userId.lena, targetType: "tag", targetValue: "react", createdAt: ago(120) },
    ]);

    // --- demand: other teams saying "we need this too", with their reasons.
    // [initiative, who, team, note, daysAgo, confirmedDaysAgo?]
    const SIGNALS: [string, PersonKey, TeamKey, string, number, number?][] = [
      [
        "featureStore",
        "dan",
        "payments",
        "Merchant fraud scoring needs the same real-time features",
        22,
      ],
      ["featureStore", "bob", "growth", "Lifecycle emails want churn-risk features", 15],
      ["sso", "lena", "design", "Our internal Figma plugin needs company SSO", 9],
      [
        "darkMode",
        "bob",
        "growth",
        "Merged from “Dark theme for the marketing site”: visitors keep asking for it",
        6,
      ],
      [
        "darkMode",
        "dan",
        "payments",
        "Merchants want the embedded checkout to match their dark sites",
        3,
      ],
      // Asked long ago and never confirmed: shown faded, not counted.
      ["components", "omar", "identity", "Login pages should use the shared components", 250],
    ];
    await db.insert(initiativeSignals).values(
      SIGNALS.map(([key, who, team, note, d, confirmed]) => ({
        initiativeId: id[key]!,
        userId: userId[who],
        teamId: teamId[team],
        note,
        createdAt: ago(d),
        confirmedAt: ago(confirmed ?? d),
      })),
    );
    await db.insert(activity).values(
      SIGNALS.map(([key, who, team, note, d]) => ({
        initiativeId: id[key]!,
        actorId: userId[who],
        kind: "signal_added" as const,
        data: { teamId: teamId[team], teamName: TEAMS.find((t) => t.key === team)!.name, note },
        createdAt: ago(d),
      })),
    );

    // --- inboxes: what each person sees when they sign in
    const note = (
      who: PersonKey,
      kind: (typeof notifications.$inferInsert)["kind"],
      key: string,
      text: string,
      d: number,
      h = 0,
      read = false,
      actor: PersonKey | null = null,
    ) => ({
      userId: userId[who],
      kind,
      initiativeId: id[key]!,
      actorId: actor ? userId[actor] : null,
      text,
      readAt: read ? ago(d, h - 1) : null,
      createdAt: ago(d, h),
    });
    await db
      .insert(notifications)
      .values([
        note(
          "priya",
          "overlap_detected",
          "dataDashboards",
          'Possible overlap (87%): your "Self-serve customer analytics dashboards" looks like another team\'s "Customer analytics dashboards for account managers"',
          2,
        ),
        note(
          "priya",
          "commented",
          "dataDashboards",
          "Bob Martinez commented on \"Self-serve customer analytics dashboards\": Yes — same need, I hadn't seen yours. Let's merge…",
          1,
          4,
          false,
          "bob",
        ),
        note(
          "priya",
          "dependency_added",
          "featureStore",
          '"Merchant fraud risk scoring" now builds on your "Feature store"',
          20,
          0,
          true,
          "dan",
        ),
        note(
          "bob",
          "overlap_detected",
          "growthDashboards",
          'Possible overlap (87%): "Customer analytics dashboards for account managers" looks like another team\'s "Self-serve customer analytics dashboards"',
          2,
        ),
        note(
          "bob",
          "commented",
          "dataDashboards",
          'Priya Shah commented on "Self-serve customer analytics dashboards": Scry just flagged Growth\'s "Customer analytics dashboards" as an 87% match…',
          1,
          20,
          false,
          "priya",
        ),
        note(
          "bob",
          "status_changed",
          "passkeys",
          '"Passkeys for customer login" moved from planned to on hold',
          4,
          0,
          true,
          "omar",
        ),
        note(
          "alice",
          "status_changed",
          "ato",
          '"Account takeover risk scoring" moved from idea to planned',
          12,
          0,
          true,
          "omar",
        ),
        note(
          "dan",
          "commented",
          "merchantRisk",
          'Omar Haddad commented on "Merchant fraud risk scoring": Looked at the overlap flag with Account takeover scoring — different problem…',
          16,
          0,
          true,
          "omar",
        ),
        note(
          "lena",
          "dependency_added",
          "components",
          '"Marketing site component kit" now builds on your "Component library 3.0"',
          22,
          0,
          false,
          "bob",
        ),
        note(
          "lena",
          "dependency_added",
          "components",
          '"Unified checkout SDK" now builds on your "Component library 3.0"',
          37,
          0,
          true,
          "dan",
        ),
        note(
          "omar",
          "dependency_added",
          "passkeys",
          '"Referral program v2" now builds on your "Passkeys for customer login"',
          30,
          0,
          true,
          "bob",
        ),
        note(
          "priya",
          "dependency_added",
          "featureStore",
          '"Lifecycle email revamp" now builds on your "Feature store"',
          15,
          0,
          false,
          "bob",
        ),
        note(
          "priya",
          "signal_added",
          "featureStore",
          'Bob Martinez (Growth) needs "Feature store" too: “Lifecycle emails want churn-risk features”',
          15,
          0,
          true,
          "bob",
        ),
        note(
          "lena",
          "merged",
          "darkMode",
          'Growth\'s "Dark theme for the marketing site" was merged into your "Dark mode everywhere"',
          6,
          0,
          false,
          "bob",
        ),
        note(
          "lena",
          "signal_added",
          "darkMode",
          'Daniel Kim (Payments Platform) needs "Dark mode everywhere" too: “Merchants want the embedded checkout to match their dark sites”',
          3,
          0,
          false,
          "dan",
        ),
        note(
          "omar",
          "signal_added",
          "sso",
          'Lena Vogel (Design Systems) needs "Enterprise SSO (SAML + OIDC)" too: “Our internal Figma plugin needs company SSO”',
          9,
          0,
          true,
          "lena",
        ),
        note(
          "omar",
          "commented",
          "passkeys",
          'Bob Martinez commented on "Passkeys for customer login": Referral v2 needs passwordless sign-up for invited friends…',
          3,
          5,
          false,
          "bob",
        ),
      ]);

    // --- Ask Scry history
    // Dan checked his idea, found a related (but different) initiative,
    // registered it, linked the feature store and dismissed the ATO match.
    const [danChat] = await db
      .insert(chatSessions)
      .values({
        userId: userId.dan,
        title: "Fraud risk scoring when onboarding new merchants",
        registeredInitiativeId: id.merchantRisk,
        createdAt: ago(21, 2),
        updatedAt: ago(20),
      })
      .returning();
    const danEvidence: ChatMessageEvidence[] = [
      { initiativeId: id.ato!, via: "semantic", score: 0.71, decision: "dismissed" },
      { initiativeId: id.featureStore!, via: "semantic", score: 0.52, decision: "linked" },
    ];
    await db.insert(chatMessages).values([
      {
        sessionId: danChat!.id,
        role: "user",
        content: "Fraud risk scoring when onboarding new merchants",
        createdAt: ago(21, 2),
      },
      {
        sessionId: danChat!.id,
        role: "assistant",
        classification: "WEAK_MATCH",
        searchQuery: "Fraud risk scoring when onboarding new merchants.",
        registerReady: true,
        content:
          "Heads up — **Account takeover risk scoring** (Identity & Security) looks related, but it's not a clear duplicate: it scores customer logins, not merchants. If your idea is genuinely different, go ahead and register it — and consider building on the **Feature store** (Data & ML).",
        evidence: danEvidence,
        createdAt: ago(21, 1.99),
      },
    ]);

    // Bob asked about dashboards and got a strong match, but hasn't acted on
    // it yet: the answer says to talk to the owning team first.
    const [bobChat] = await db
      .insert(chatSessions)
      .values({
        userId: userId.bob,
        title: "Dashboards so account managers can explore customer analytics",
        createdAt: ago(1, 6),
        updatedAt: ago(1, 6),
      })
      .returning();
    await db.insert(chatMessages).values([
      {
        sessionId: bobChat!.id,
        role: "user",
        content: "Dashboards so account managers can explore customer analytics themselves",
        createdAt: ago(1, 6),
      },
      {
        sessionId: bobChat!.id,
        role: "assistant",
        classification: "STRONG_MATCH",
        searchQuery: "Dashboards so account managers can explore customer analytics themselves.",
        // A likely duplicate: talk to the owners first, so no Register offer.
        registerReady: false,
        content:
          "This looks like the same thing as **Customer analytics dashboards for account managers** — already registered by your own team. Also related: **Self-serve customer analytics dashboards**, owned by Data & ML (currently planned). Talk to Priya Shah before building it twice.",
        evidence: [
          { initiativeId: id.growthDashboards!, via: "semantic", score: 0.87 },
          { initiativeId: id.dataDashboards!, via: "semantic", score: 0.74 },
        ],
        createdAt: ago(1, 5.99),
      },
    ]);

    // Omar asked about login rate limiting: a weak match on his own team's
    // passkeys, and — one relationship away — Growth's referral program,
    // which builds on it. Scry found that through the relationship, not the words.
    const [omarChat] = await db
      .insert(chatSessions)
      .values({
        userId: userId.omar,
        title: "Rate limiting for login attempts",
        createdAt: ago(5, 3),
        updatedAt: ago(5, 3),
      })
      .returning();
    await db.insert(chatMessages).values([
      {
        sessionId: omarChat!.id,
        role: "user",
        content: "Rate limiting for login attempts",
        createdAt: ago(5, 3),
      },
      {
        sessionId: omarChat!.id,
        role: "assistant",
        classification: "WEAK_MATCH",
        searchQuery: "Rate limiting for login attempts.",
        registerReady: true,
        content:
          "Possibly related: **Passkeys for customer login** (your own team) also changes how customers sign in. **Referral program v2** (Growth) builds on passkeys, so Bob Martinez may want to hear about login changes too. If rate limiting is its own piece of work, go ahead and register it.",
        evidence: [
          { initiativeId: id.passkeys!, via: "semantic", score: 0.68 },
          { initiativeId: id.referral!, via: "graph", hops: 1, throughInitiativeId: id.passkeys! },
        ],
        createdAt: ago(5, 2.99),
      },
    ]);

    // Priya asked about something nobody works on yet and hasn't registered it.
    const [priyaChat] = await db
      .insert(chatSessions)
      .values({
        userId: userId.priya,
        title: "Data contracts for event schemas",
        createdAt: ago(0, 5),
        updatedAt: ago(0, 5),
      })
      .returning();
    await db.insert(chatMessages).values([
      {
        sessionId: priyaChat!.id,
        role: "user",
        content: "Data contracts between teams for our event schemas",
        createdAt: ago(0, 5),
      },
      {
        sessionId: priyaChat!.id,
        role: "assistant",
        classification: "NO_MATCH",
        searchQuery: "Data contracts between teams for their event schemas.",
        registerReady: true,
        content:
          "Nothing similar is registered yet. Go ahead and register it, so other teams can find it and Scry can catch the next overlap.",
        evidence: [],
        createdAt: ago(0, 4.99),
      },
    ]);

    // --- waiting for approval: a request to join, and a team someone asked for
    await db.insert(teamJoinRequests).values({
      userId: userId.noah,
      teamId: teamId.data,
      createdAt: ago(1),
    });
    const [pendingTeam] = await db
      .insert(teams)
      .values({
        name: "Customer Support Tools",
        orgUnit: "Operations",
        country: "NL",
        status: "pending",
        createdBy: userId.mia,
        createdAt: ago(2),
        updatedAt: ago(2),
      })
      .returning();

    // --- admin history (Admin → Audit log) and API tokens (Settings)
    const person = (key: PersonKey) => PEOPLE.find((p) => p.key === key)!.name;
    const teamLabel = (key: TeamKey) => TEAMS.find((t) => t.key === key)!.name;
    await db.insert(auditLog).values([
      ...TEAMS.map((t, n) => ({
        actorId: userId.alice,
        action: "team.created",
        targetType: "team",
        targetId: teamId[t.key],
        summary: `${person("alice")} created the team ${t.key === "identity" ? "Identity" : t.name}`,
        teamId: teamId[t.key],
        data: {},
        createdAt: ago(365, -n),
      })),
      {
        actorId: userId.alice,
        action: "team.updated",
        targetType: "team",
        targetId: teamId.identity,
        summary: `${person("alice")} renamed the team Identity to ${teamLabel("identity")}`,
        teamId: teamId.identity,
        data: { name: { from: "Identity", to: teamLabel("identity") } },
        createdAt: ago(200),
      },
      {
        actorId: userId.alice,
        action: "user.role_changed",
        targetType: "user",
        targetId: userId.omar,
        summary: `${person("alice")} changed ${person("omar")}'s role from admin to member`,
        data: { from: "admin", to: "member" },
        createdAt: ago(150),
      },
      // Each team admin was made one when the team was set up.
      ...PEOPLE.filter((p) => "teamAdmin" in p && p.teamAdmin && p.team).map((p, n) => ({
        actorId: userId.alice,
        action: "team.admin_granted",
        targetType: "user",
        targetId: userId[p.key],
        summary: `${person("alice")} made ${p.name} a team admin of ${teamLabel(p.team as TeamKey)}`,
        teamId: teamId[p.team as TeamKey],
        data: {},
        createdAt: ago(300, -n),
      })),
      // Sam asked to join Growth, and Bob (its team admin) let him in.
      {
        actorId: userId.sam,
        action: "team.join_requested",
        targetType: "team",
        targetId: teamId.growth,
        summary: `${person("sam")} asked to join ${teamLabel("growth")}`,
        teamId: teamId.growth,
        data: {},
        createdAt: ago(21),
      },
      {
        actorId: userId.bob,
        action: "team.member_approved",
        targetType: "user",
        targetId: userId.sam,
        summary: `${person("bob")} let ${person("sam")} join ${teamLabel("growth")}`,
        teamId: teamId.growth,
        data: {},
        createdAt: ago(20),
      },
      // Waiting: Noah to join Data & ML (Priya decides), Mia's new team (Alice decides).
      {
        actorId: userId.noah,
        action: "team.join_requested",
        targetType: "team",
        targetId: teamId.data,
        summary: `${person("noah")} asked to join ${teamLabel("data")}`,
        teamId: teamId.data,
        data: {},
        createdAt: ago(1),
      },
      {
        actorId: userId.mia,
        action: "team.requested",
        targetType: "team",
        targetId: pendingTeam!.id,
        summary: `${person("mia")} asked to create the team ${pendingTeam!.name}`,
        teamId: pendingTeam!.id,
        data: {},
        createdAt: ago(2),
      },
      {
        actorId: userId.alice,
        action: "token.created",
        targetType: "user",
        targetId: userId.alice,
        summary: `${person("alice")} created a read-only API token "Laptop scripts"`,
        data: {},
        createdAt: ago(30),
      },
      {
        actorId: userId.bob,
        action: "initiatives.merged",
        targetType: "initiative",
        targetId: id.darkMode!,
        summary: `${person("bob")} merged “${spec.darkThemeSite!.title}” (${teamLabel("growth")}) into “${spec.darkMode!.title}” (${teamLabel("design")})`,
        data: {
          sourceId: id.darkThemeSite,
          targetId: id.darkMode,
          movedRelationships: 0,
          droppedRelationships: 0,
        },
        createdAt: ago(6),
      },
    ]);
    // Random secrets nobody knows: the tokens show up in Settings but can't be used.
    const unusable = () => createHash("sha256").update(randomBytes(32)).digest("hex");
    await db.insert(personalAccessTokens).values([
      {
        userId: userId.alice,
        tokenHash: unusable(),
        name: "Laptop scripts",
        scope: "read",
        createdAt: ago(30),
        lastUsedAt: ago(2),
        expiresAt: ago(-60),
      },
      {
        userId: userId.alice,
        tokenHash: unusable(),
        name: "Roadmap import script",
        scope: "write",
        createdAt: ago(200),
        lastUsedAt: ago(110),
        expiresAt: ago(20),
      },
    ]);

    console.log(
      `Seeded the demo org: ${TEAMS.length} teams, ${PEOPLE.length} people, ${INITIATIVES.length} initiatives, ` +
        `${EDGES.length} relationships, 4 overlaps, ${thread.length} comments, 4 Ask Scry chats. See docs/demo.md.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
