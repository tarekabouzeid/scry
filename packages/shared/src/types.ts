// Plain TS types mirroring the API's response shapes — kept independent of
// @scry/db (which pulls in drizzle/postgres, server-only) so apps/web and
// clients can import just the shapes without a server-side dependency.

export type InitiativeStatus =
  "idea" | "planned" | "in_progress" | "on_hold" | "shipped" | "cancelled";

export type InitiativeTier = "strategic" | "tactical";
export type UserRole = "member" | "admin";
/**
 * Relationships say which teams should know about each other, never what is
 * scheduled after what. They only connect different teams. "related" has no
 * direction.
 */
export type EdgeType = "builds_on" | "replaces" | "related";

export interface Team {
  id: string;
  name: string;
  orgUnit: string | null;
  country: string | null;
  /** "pending" until an admin approves a team created during onboarding. */
  status: "pending" | "active";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  employeeId: string | null;
  teamId: string | null;
  role: UserRole;
  teamAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The org units and countries a team can be filed under (set in the api's environment). */
export interface TeamOptions {
  orgUnits: string[];
  countries: string[];
}

/** Someone asking to join a team. */
export interface TeamJoinRequest {
  id: string;
  teamId: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  user: { id: string; name: string; email: string };
}

/** A member as their team admin sees them. */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  teamAdmin: boolean;
}

/**
 * Where someone stands: in a team, waiting (to join one, or for a team they
 * created to be approved), or not started. Admins may have no team at all.
 */
export interface OnboardingStatus {
  hasTeam: boolean;
  team: Team | null;
  pending:
    { kind: "join"; requestId: string; team: Team } | { kind: "new_team"; team: Team } | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  /** Runs their team: approves joiners, removes members, edits the team's work. */
  teamAdmin: boolean;
  /** When the product tour was finished or skipped, or null for a first visit. */
  tourSeenAt?: string | null;
}

export interface Initiative {
  id: string;
  title: string;
  summary: string;
  status: InitiativeStatus;
  tier: InitiativeTier;
  teamId: string;
  submittedBy: string;
  contactPerson: string;
  startDate: string | null;
  targetDate: string | null;
  tags: string[];
  externalLink: string | null;
  /** Why it's on hold, in the owner's words (only while on hold). */
  holdReason?: string | null;
  createdAt: string;
  updatedAt: string;
  /** False until the async embedding job runs — not yet findable by semantic search. */
  embeddingReady?: boolean;
  /** Set when this was folded into another initiative as a duplicate. */
  mergedIntoId: string | null;
  mergedAt: string | null;
  /** How many other teams said "we need this too". */
  signalTeams?: number;
  /** One-sentence AI summary of what it is and where it stands; null until written. */
  tldr?: string | null;
  tldrAt?: string | null;
}

/** "We need this too" not confirmed for this long fades: shown, but not counted. */
export const DEMAND_STALE_AFTER_DAYS = 180;

export interface InitiativeSignal {
  id: string;
  note: string | null;
  createdAt: string;
  /** Last time the team said it still needs this. */
  confirmedAt: string;
  /** Not confirmed for a while; counts for less until someone confirms it. */
  stale: boolean;
  user: { id: string; name: string };
  team: { id: string; name: string };
}

export interface Edge {
  id: string;
  fromInitiativeId: string;
  toInitiativeId: string;
  type: EdgeType;
  createdBy: string;
  createdAt: string;
}

export const INITIATIVE_STATUSES: InitiativeStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "on_hold",
  "shipped",
  "cancelled",
];

export const INITIATIVE_TIERS: InitiativeTier[] = ["strategic", "tactical"];

export type ChatMessageRole = "user" | "assistant" | "tool";
export type MatchClassification = "STRONG_MATCH" | "WEAK_MATCH" | "NO_MATCH";

export interface ChatMessageEvidence {
  initiativeId: string;
  via: "semantic" | "graph";
  score?: number;
  hops?: number;
  throughInitiativeId?: string;
  decision?: "linked" | "dismissed";
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  registeredInitiativeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  evidence: ChatMessageEvidence[] | null;
  /** Null when the reply had no idea to search for (a greeting, a question). */
  classification: MatchClassification | null;
  /** What the reply searched for: the idea as Scry understood it (AI-written). */
  searchQuery: string | null;
  /** Scry judged the idea concrete enough to offer registering it. */
  registerReady: boolean;
  createdAt: string;
}

/** What Ask Scry is doing while it answers (its tool calls), shown as it happens. */
export type ChatActivity =
  | { tool: "search_initiatives"; query: string }
  | { tool: "get_initiative"; title: string }
  | { tool: "offer_registration" };

export interface PostMessageResponse {
  message: ChatMessage;
  classification: MatchClassification | null;
  candidates: Initiative[];
}

export interface InitiativeDraft {
  title: string;
  summary: string;
  tags: string[];
  tier: InitiativeTier;
}

export interface Comment {
  id: string;
  initiativeId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

export type ActivityKind =
  | "created"
  | "updated"
  | "status_changed"
  | "edge_added"
  | "edge_removed"
  | "commented"
  | "overlap_detected"
  | "registered_from_chat"
  | "merged_into"
  | "merged_from"
  | "merge_requested"
  | "merge_declined"
  | "signal_added";

export interface ActivityEntry {
  id: string;
  initiativeId: string;
  actorId: string | null;
  actorName: string | null;
  kind: ActivityKind;
  data: Record<string, unknown>;
  createdAt: string;
}

export type OverlapStatus = "open" | "dismissed" | "linked" | "merged";

export interface Overlap {
  id: string;
  initiativeAId: string;
  initiativeBId: string;
  score: number;
  status: OverlapStatus;
  createdAt: string;
  updatedAt: string;
}

export type NotificationKind =
  | "overlap_detected"
  | "status_changed"
  | "dependency_added"
  | "commented"
  | "merged"
  | "signal_added"
  | "team_request"
  | "team_update"
  | "merge_request"
  | "merge_update";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  initiativeId: string | null;
  actorId: string | null;
  text: string;
  readAt: string | null;
  createdAt: string;
}

export type SubscriptionTarget = "team" | "initiative" | "tag";

/** A tag used by at least one live initiative, with how many use it. */
export interface TagCount {
  tag: string;
  count: number;
}

export interface Subscription {
  id: string;
  targetType: SubscriptionTarget;
  targetValue: string;
  createdAt: string;
}

export interface PersonalAccessToken {
  id: string;
  name: string | null;
  /** read: GET only (the default); write: acts fully as its owner. */
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface ImportResult {
  created: number;
  errors: { row: number; message: string }[];
}

// ---------- AI & models (admin-managed LLM configuration) ----------

/**
 * How Scry authenticates to the OpenAI-compatible endpoint (OpenAI, Azure,
 * vLLM, Ollama, or a LiteLLM gateway):
 * - none: no credentials (local models).
 * - api_key: a static key, e.g. a LiteLLM virtual key.
 * - oauth2_client_credentials: Scry fetches a JWT from your IdP's token
 *   endpoint and sends it as the bearer token (LiteLLM JWT auth).
 * - signed_jwt: Scry signs its own short-lived RS256 JWT; the gateway
 *   verifies it against Scry's public JWKS.
 */
export type LlmAuthMode = "none" | "api_key" | "oauth2_client_credentials" | "signed_jwt";

export interface LlmAuthConfig {
  mode: LlmAuthMode;
  /** api_key: header carrying the key. "Authorization" sends "Bearer <key>". */
  headerName: string;
  /** oauth2_client_credentials */
  tokenUrl: string;
  clientId: string;
  scope: string;
  audience: string;
  clientAuthMethod: "client_secret_basic" | "client_secret_post";
  /** signed_jwt (audience is shared with oauth2 above) */
  issuer: string;
  subject: string;
  ttlSeconds: number;
  extraClaims: Record<string, unknown>;
}

export interface LlmSettings {
  connection: {
    baseUrl: string;
    timeoutMs: number;
    /** Extra, non-secret headers sent with every request. */
    headers: Record<string, string>;
    auth: LlmAuthConfig;
  };
  models: {
    /**
     * Semantic search, overlap detection. `dimensions` is the size of every
     * stored vector; `shorten` asks the model for that size (text-embedding-3-*).
     * The prefixes go before searches and before initiatives, for models
     * trained with them (EmbeddingGemma, E5, BGE, nomic).
     */
    embedding: {
      model: string;
      dimensions: number;
      shorten: boolean;
      queryPrefix: string;
      documentPrefix: string;
    };
    /** Ask Scry's answers. */
    assistant: { model: string; temperature: number | null };
    /** Background tasks such as drafting an initiative from a chat. */
    tasks: { model: string; temperature: number | null };
  };
  matching: { strongMatch: number; weakMatch: number; overlap: number };
  /** Send the requesting user to the gateway (OpenAI `user` field) for spend tracking. */
  userTracking: "off" | "id" | "email";
}

export type LlmRole = "embedding" | "assistant" | "tasks";
export type LlmSource = "database" | "environment" | "none";

export interface LlmSecretsState {
  apiKey: boolean;
  clientSecret: boolean;
  signingKey: boolean;
}

export interface LlmAdminView {
  source: LlmSource;
  settings: LlmSettings;
  defaults: LlmSettings;
  secrets: LlmSecretsState;
  /** False when stored secrets can't be decrypted (the encryption key changed). */
  secretsReadable: boolean;
  /** activatesAt: when a freshly rotated key starts signing (null = it already does). */
  signingKey: { keyId: string; createdAt: string; activatesAt: string | null } | null;
  jwksPath: string;
  /** LLM_ALLOWED_HOSTS, when the deployment restricts where AI traffic may go. */
  allowedHosts: string[] | null;
  indexing: { total: number; indexed: number };
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface LlmSecretsInput {
  /** Omit to keep the stored value, "" to clear it. */
  apiKey?: string;
  clientSecret?: string;
}

export interface LlmTestResult {
  role: LlmRole;
  model: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
  /** Embeddings only: the size the model actually returned, when it differs. */
  actualDimensions?: number;
}

export interface LlmStatus {
  configured: boolean;
  source: LlmSource;
  /** The admin-tuned cut-offs, so match labels agree with the server's classification. */
  matching: { strongMatch: number; weakMatch: number };
}

// ---------- Admin audit log ----------

export interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  targetType: string | null;
  targetId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  /** null when the acting user has since been deleted. */
  actor: { id: string; name: string; email: string } | null;
}

export interface LlmUsageSummary {
  hours: number;
  bucket: "hour" | "day";
  roles: Array<{
    role: LlmRole;
    calls: number;
    errors: number;
    p50: number | null;
    p95: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    lastError: { message: string; at: string } | null;
  }>;
  series: Array<{ at: string; calls: number; errors: number }>;
}

// ---------- Portfolio brief (executive report) ----------

/** A reference to an initiative inside a report — enough to name and link it. */
export interface BriefInitiativeRef {
  id: string;
  title: string;
  teamId: string;
  status: InitiativeStatus;
  tier: InitiativeTier;
  /** Who to talk to about it. */
  contactName: string | null;
}

export interface BriefTeamRow {
  teamId: string;
  name: string;
  orgUnit: string | null;
  /** Live initiatives (not cancelled, not merged away). */
  total: number;
  byStatus: Record<InitiativeStatus, number>;
  newInPeriod: number;
  shippedInPeriod: number;
  /** Distinct other teams that want this team's work (asked or build on it). */
  demandTeams: number;
  openOverlaps: number;
  /** Last time anything about the team's initiatives changed. */
  lastActivityAt: string | null;
}

export interface BriefTheme {
  tag: string;
  /** Tags that always appear together with `tag`, folded into one theme. */
  related: string[];
  count: number;
  newInPeriod: number;
  teamIds: string[];
  /** Initiatives carrying the tag, most recent first (at most 5). */
  initiatives: BriefInitiativeRef[];
}

/** A team that wants an initiative: it asked ("we need this too") or builds on it. */
export interface BriefWant {
  teamId: string;
  how: "asked" | "builds_on";
  /** The team's reason: its note, or the title of its initiative that builds on this. */
  reason: string | null;
  /** Its initiative that builds on this one (for "builds_on"). */
  via?: BriefInitiativeRef;
  at: string;
  /** Asked long ago and never confirmed since; shown, but not counted. */
  stale: boolean;
}

export interface BriefWanted {
  initiative: BriefInitiativeRef;
  /** Fresh wants, one per team (a team that both asks and builds on it counts once). */
  teams: number;
  wants: BriefWant[];
  /** Still an idea or on hold: wanted, but nobody has committed to it. */
  uncommitted: boolean;
}

export interface BriefOverlap {
  id: string;
  score: number;
  a: BriefInitiativeRef;
  b: BriefInitiativeRef;
  detectedAt: string;
}

export interface BriefStale {
  initiative: BriefInitiativeRef;
  updatedAt: string;
}

export type BriefDecisionKind = "duplicate" | "uncommitted_demand" | "at_risk" | "gone_quiet";

/** Something leadership should decide or ask about, with who to talk to. */
export interface BriefDecision {
  kind: BriefDecisionKind;
  initiative: BriefInitiativeRef;
  /** The other side of a duplicate. */
  other?: BriefInitiativeRef;
  /** Teams involved besides the owner. */
  teamIds: string[];
  /** Kind-specific number: similarity %, wanting teams, teams building on it, idle days. */
  value: number;
}

/** A theme (tag) that new work in the period clusters around. */
export interface BriefEmerging extends BriefTheme {
  /** Several teams started on it separately: worth connecting now. */
  separate: boolean;
}

export type BriefChangeKind = "merged" | "linked" | "dismissed" | "moved" | "shipped" | "wanted";

/** One thing that changed in the period. */
export interface BriefChange {
  kind: BriefChangeKind;
  initiative: BriefInitiativeRef;
  other?: BriefInitiativeRef;
  /** "moved": the status it moved from. */
  from?: InitiativeStatus;
  /** "wanted": the team that asked or now builds on it. */
  teamId?: string;
  at: string;
}

export interface PortfolioBrief {
  generatedAt: string;
  /** Period length in days; null for all time. */
  days: number | null;
  since: string | null;
  /** Org unit the brief is scoped to, or null for the whole organisation. */
  orgUnit: string | null;
  orgUnits: string[];
  /** Plain sentences built from the figures below, so the brief reads without AI. */
  summary: string[];
  totals: {
    live: number;
    byStatus: Record<InitiativeStatus, number>;
    strategic: number;
    newInPeriod: number;
    /** New in the period before this one, for comparison (null for all time). */
    newPreviousPeriod: number | null;
    shippedInPeriod: number;
    openOverlaps: number;
    goneQuiet: number;
  };
  /** At most five, most important first. */
  decisions: BriefDecision[];
  emerging: BriefEmerging[];
  newest: (BriefInitiativeRef & { createdAt: string })[];
  wanted: BriefWanted[];
  /** What changed in the period (empty for all time). */
  changes: BriefChange[];
  teams: BriefTeamRow[];
  overlaps: BriefOverlap[];
  stale: BriefStale[];
}

/** The optional AI-written summary of a brief. Every point cites initiatives from it. */
export interface BriefNarrative {
  headline: string;
  points: { text: string; initiativeIds: string[] }[];
  generatedAt: string;
}

/** Existing work that looks like an idea someone is about to register. */
export interface SimilarInitiative {
  initiative: Initiative;
  score: number;
  /** "strong": probably the same thing; "weak": related. */
  strength: "strong" | "weak";
}

/** AI help while writing an initiative: proposed fields, and what the summary covers. */
export interface InitiativeAssist {
  title: string;
  summary: string;
  tags: string[];
  tier: InitiativeTier;
  /** Whether the (proposed) summary says what it is, who it's for and why it matters. */
  coverage: { what: boolean; who: boolean; why: boolean };
}

// --- Paginated initiative lists ------------------------------------------

/** The orders the initiatives list supports (each one backed by an index). */
export type InitiativeSort = "updated" | "title" | "status" | "target";

export const INITIATIVE_SORTS: InitiativeSort[] = ["updated", "title", "status", "target"];

/** One page of initiatives; pass `nextCursor` back as `cursor` for the next. */
export interface InitiativePage {
  items: Initiative[];
  nextCursor: string | null;
}

/** How many initiatives fall under a status or a team (`/initiatives/counts`). */
export interface InitiativeCount {
  key: string;
  count: number;
}

// ---------------------------------------------------------------------- Graph

/** An initiative (or a team's related work) and what's up to two relationship steps away. */
export interface GraphNeighbourhood {
  /** Includes the seed(s). */
  nodes: Initiative[];
  /** Only edges between returned nodes. */
  edges: Edge[];
  /** Hit the node cap: there's more beyond what's returned. */
  truncated: boolean;
}

/** A team on the graph's map of the organisation. */
export interface GraphTeam {
  id: string;
  name: string;
  orgUnit: string | null;
  /** Initiatives the team has (merged ones left out). */
  total: number;
  /** How many of them are related to another team's work. */
  connected: number;
  byStatus: Partial<Record<InitiativeStatus, number>>;
}

/** Relationships of one type from one team's work to another's, counted. */
export interface GraphTeamLink {
  fromTeamId: string;
  toTeamId: string;
  type: EdgeType;
  count: number;
}

/** `GET /graph/overview`: every team with work, and how their work connects. */
export interface GraphOverview {
  teams: GraphTeam[];
  links: GraphTeamLink[];
  /** The most initiatives `GET /graph/teams/:id` returns for one team. */
  teamLimit: number;
}

export interface GraphInitiative {
  id: string;
  title: string;
  status: InitiativeStatus;
  teamId: string;
}

export interface GraphTeamEdge {
  id: string;
  fromInitiativeId: string;
  toInitiativeId: string;
  fromTeamId: string;
  toTeamId: string;
  type: EdgeType;
}

/**
 * `GET /graph/teams/:id`: a team's initiatives (related work first, then the
 * newest, up to `teamLimit`) and every relationship touching its work.
 */
export interface GraphTeamDetail {
  teamId: string;
  nodes: GraphInitiative[];
  /** All the team's initiatives; more than `nodes.length` when capped. */
  total: number;
  edges: GraphTeamEdge[];
}

/**
 * A request to fold one team's duplicate into another team's initiative,
 * waiting for the target's owners (unless the person merging could edit both).
 */
export interface MergeRequest {
  id: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  source: { id: string; title: string; teamId: string; teamName: string };
  target: { id: string; title: string; teamId: string; teamName: string };
  requestedBy: { id: string; name: string } | null;
  createdAt: string;
  /** The viewer may accept or decline it (they can edit the target). */
  canDecide: boolean;
  /** The viewer may withdraw it (they asked, or can edit the duplicate). */
  canWithdraw: boolean;
}

/** `POST /initiatives/:id/merge`: merged now, or asked the target's owners. */
export type MergeOutcome =
  { outcome: "merged"; initiative: Initiative } | { outcome: "requested"; request: MergeRequest };

// ------------------------------------------------------------- MCP (AI tools)

/** An AI tool someone connected to Scry (an OAuth grant). */
export interface McpConnection {
  id: string;
  client: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** `GET /mcp-connections`: whether MCP is on, its address, and your connected tools. */
export interface McpConnections {
  enabled: boolean;
  url: string;
  connections: McpConnection[];
}

export interface McpPersonUsage {
  user: { id: string; name: string; email: string };
  calls: number;
  clients: string[];
  lastCallAt: string;
}

/** `GET /admin/mcp`. */
export interface McpAdminSettings {
  enabled: boolean;
  url: string;
  retentionDays: number;
  people: McpPersonUsage[];
}

/** One tool call, as the admin usage log shows it. */
export interface McpCall {
  id: string;
  user: { id: string; name: string; email: string };
  client: string;
  via: "oauth" | "token";
  tool: string;
  input: Record<string, unknown>;
  resultIds: string[];
  ok: boolean;
  createdAt: string;
}

/** What the consent page shows about an AI tool asking to connect. */
export interface OAuthRequestInfo {
  clientName: string;
  returnsTo: string;
  scope: string;
  enabled: boolean;
}
