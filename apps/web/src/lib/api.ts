import type {
  ActivityEntry,
  AppNotification,
  AuditEntry,
  AuthenticatedUser,
  ChatActivity,
  ChatMessage,
  ChatSession,
  Comment,
  Edge,
  EdgeType,
  ImportResult,
  Initiative,
  InitiativeCount,
  InitiativeDraft,
  InitiativePage,
  InitiativeSignal,
  InitiativeSort,
  LlmAdminView,
  LlmSecretsInput,
  LlmSettings,
  LlmStatus,
  LlmTestResult,
  LlmUsageSummary,
  Overlap,
  OverlapStatus,
  SimilarInitiative,
  InitiativeAssist,
  BriefNarrative,
  PortfolioBrief,
  PersonalAccessToken,
  PostMessageResponse,
  Subscription,
  SubscriptionTarget,
  TagCount,
  OnboardingStatus,
  Team,
  TeamJoinRequest,
  TeamMember,
  TeamOptions,
  User,
  UserRole,
  GraphOverview,
  GraphTeamDetail,
  MergeOutcome,
  MergeRequest,
  McpAdminSettings,
  McpCall,
  McpConnections,
  OAuthRequestInfo,
} from "@scry/shared";

/** Writable initiative fields; null clears an optional field. */
export interface InitiativeInput {
  title: string;
  summary: string;
  status?: Initiative["status"];
  tier?: Initiative["tier"];
  teamId?: string;
  contactPerson?: string;
  startDate?: string | null;
  targetDate?: string | null;
  tags?: string[];
  externalLink?: string | null;
  holdReason?: string | null;
}

/** Filters the list and the counts share. */
export interface InitiativeFilters {
  teamId?: string;
  /** Leave out this team's work. */
  notTeamId?: string;
  /** Leave out merged duplicates. */
  unmerged?: boolean;
  status?: string;
  tier?: string;
  search?: string;
  tag?: string;
  /** A date window (YYYY-MM-DD): dated work whose span touches it. */
  from?: string;
  to?: string;
}

export interface InitiativeListQuery extends InitiativeFilters {
  sort?: InitiativeSort;
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

function queryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    // Nest validation errors come back as an array of messages; OAuth
    // endpoints answer RFC-style, with error_description.
    const message = Array.isArray(body.message)
      ? body.message.join("; ")
      : (body.message ?? body.error_description);
    throw new ApiError(res.status, message ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type ChatStreamEvent =
  | ({ type: "tool" } & ChatActivity)
  | { type: "delta"; text: string }
  | ({ type: "done" } & PostMessageResponse)
  | { type: "error"; message: string };

/**
 * POST, then read a newline-delimited JSON response event by event.
 * `onEvent` returns the final result when it sees it; errors before the
 * stream starts arrive as normal HTTP errors.
 */
async function streamNdjson<E, R>(
  path: string,
  body: unknown,
  onEvent: (event: E) => R | undefined,
): Promise<R> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(err.message) ? err.message.join("; ") : err.message;
    throw new ApiError(res.status, message ?? res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: R | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) result = onEvent(JSON.parse(line) as E) ?? result;
    }
    if (done) break;
  }
  if (result === undefined) throw new ApiError(502, "The answer was cut off — try again.");
  return result;
}

export const api = {
  me: () => request<AuthenticatedUser>("/auth/me"),
  markTourSeen: () => request<void>("/auth/me/tour-seen", { method: "POST" }),
  /** Sign in, then come back to `returnTo` (a path in this app). */
  loginUrl: (returnTo?: string) =>
    `${API_URL}/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
  /** Absolute URL of an api path — for things users copy, like the JWKS URL. */
  url: (path: string) => `${API_URL}${path}`,
  logoutUrl: () => `${API_URL}/auth/logout`,

  listTeams: () => request<Team[]>("/teams"),
  /** Admins: active teams and the ones waiting for approval. */
  listAllTeams: () => request<Team[]>("/teams?includePending=true"),

  teamOptions: () => request<TeamOptions>("/teams/options"),
  onboardingStatus: () => request<OnboardingStatus>("/onboarding/status"),
  /** Ask to join a team; its team admins decide. */
  requestToJoin: (teamId: string) =>
    request<OnboardingStatus>("/onboarding/join", {
      method: "POST",
      body: JSON.stringify({ teamId }),
    }),
  /** Create a team; an admin approves it, and its creator becomes its team admin. */
  requestTeam: (dto: { name: string; orgUnit: string; country: string }) =>
    request<OnboardingStatus>("/onboarding/create-team", {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  withdrawPending: () => request<OnboardingStatus>("/onboarding/pending", { method: "DELETE" }),

  // --- Running a team (its team admins, or an admin)
  teamMembers: (teamId: string) => request<TeamMember[]>(`/teams/${teamId}/members`),
  teamRequests: (teamId: string) => request<TeamJoinRequest[]>(`/teams/${teamId}/requests`),
  allJoinRequests: () => request<TeamJoinRequest[]>("/teams/requests"),
  decideJoinRequest: (teamId: string, requestId: string, decision: "approve" | "decline") =>
    request<{ ok: true }>(`/teams/${teamId}/requests/${requestId}/${decision}`, {
      method: "POST",
    }),
  removeMember: (teamId: string, userId: string) =>
    request<{ ok: true }>(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
  setTeamAdmin: (teamId: string, userId: string, teamAdmin: boolean) =>
    request<TeamMember>(`/teams/${teamId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ teamAdmin }),
    }),
  teamAudit: (teamId: string) => request<AuditEntry[]>(`/teams/${teamId}/audit`),
  approveTeam: (teamId: string) => request<Team>(`/teams/${teamId}/approve`, { method: "POST" }),
  declineTeam: (teamId: string) =>
    request<{ declined: true }>(`/teams/${teamId}/decline`, { method: "POST" }),
  createTeam: (dto: { name: string; orgUnit: string; country: string }) =>
    request<Team>("/teams", { method: "POST", body: JSON.stringify(dto) }),

  /** One page; pass `nextCursor` back as `cursor` for the next. */
  listInitiatives: (query: InitiativeListQuery = {}) =>
    request<InitiativePage>(`/initiatives${queryString(query)}`),
  countInitiatives: (groupBy: "status" | "team", filters: InitiativeFilters = {}) =>
    request<InitiativeCount[]>(`/initiatives/counts${queryString({ ...filters, groupBy })}`),
  /** At most 200 ids; unknown ones are left out. */
  lookupInitiatives: (ids: string[]) =>
    request<Initiative[]>(`/initiatives/lookup?ids=${ids.map(encodeURIComponent).join(",")}`),
  getInitiative: (id: string) => request<Initiative>(`/initiatives/${id}`),
  createInitiative: (dto: InitiativeInput) =>
    request<Initiative>("/initiatives", { method: "POST", body: JSON.stringify(dto) }),
  updateInitiative: (id: string, dto: Partial<InitiativeInput>) =>
    request<Initiative>(`/initiatives/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
  deleteInitiative: (id: string) => request<void>(`/initiatives/${id}`, { method: "DELETE" }),
  importInitiatives: (rows: InitiativeInput[]) =>
    request<ImportResult>("/initiatives/import", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  listActivity: (id: string) => request<ActivityEntry[]>(`/initiatives/${id}/activity`),
  listComments: (id: string) => request<Comment[]>(`/initiatives/${id}/comments`),
  createComment: (id: string, body: string) =>
    request<Comment>(`/initiatives/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  deleteComment: (id: string) => request<void>(`/comments/${id}`, { method: "DELETE" }),

  /** The strongest open overlaps (100), for reviewing them. */
  listOverlaps: () => request<Overlap[]>("/overlaps"),
  /** Every open overlap involving these initiatives (at most 200 ids). */
  listOverlapsFor: (initiativeIds: string[]) =>
    request<Overlap[]>(`/overlaps?initiativeIds=${initiativeIds.join(",")}`),
  countOverlaps: () => request<{ open: number }>("/overlaps/count"),
  resolveOverlap: (id: string, status: OverlapStatus) =>
    request<Overlap>(`/overlaps/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  listUsers: () => request<User[]>("/users"),
  updateUser: (id: string, dto: { teamId?: string | null; role?: UserRole; teamAdmin?: boolean }) =>
    request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
  updateTeam: (id: string, dto: { name?: string; orgUnit?: string; country?: string }) =>
    request<Team>(`/teams/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
  mergeTeam: (id: string, intoTeamId: string) =>
    request<{ team: Team; movedUsers: number; movedInitiatives: number }>(`/teams/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ intoTeamId }),
    }),

  notifications: () =>
    request<{ items: AppNotification[]; unreadCount: number }>("/me/notifications"),
  markAllNotificationsRead: () => request<void>("/me/notifications/read", { method: "POST" }),
  markNotificationRead: (id: string) =>
    request<void>(`/me/notifications/${id}/read`, { method: "POST" }),
  subscriptions: () => request<Subscription[]>("/me/subscriptions"),
  tags: () => request<TagCount[]>("/initiatives/tags"),
  subscribe: (targetType: SubscriptionTarget, targetValue: string) =>
    request<Subscription>("/me/subscriptions", {
      method: "POST",
      body: JSON.stringify({ targetType, targetValue }),
    }),
  unsubscribe: (id: string) => request<void>(`/me/subscriptions/${id}`, { method: "DELETE" }),

  listTokens: () => request<PersonalAccessToken[]>("/auth/pat"),
  createToken: (dto: { name?: string; expiresInDays?: number; scope?: "read" | "write" }) =>
    request<{ token: string }>("/auth/pat", { method: "POST", body: JSON.stringify(dto) }),
  revokeToken: (id: string) => request<void>(`/auth/pat/${id}`, { method: "DELETE" }),

  mcpConnections: () => request<McpConnections>("/mcp-connections"),
  disconnectMcp: (id: string) => request<void>(`/mcp-connections/${id}`, { method: "DELETE" }),
  oauthRequest: (requestToken: string) =>
    request<OAuthRequestInfo>(`/oauth/request?request=${encodeURIComponent(requestToken)}`),
  oauthDecision: (requestToken: string, allow: boolean) =>
    request<{ redirect: string }>("/oauth/decision", {
      method: "POST",
      body: JSON.stringify({ request: requestToken, allow }),
    }),
  mcpAdmin: () => request<McpAdminSettings>("/admin/mcp"),
  setMcpEnabled: (enabled: boolean) =>
    request<{ enabled: boolean }>("/admin/mcp", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  mcpCalls: (userId?: string) =>
    request<McpCall[]>(`/admin/mcp/calls${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`),
  revokeMcpPerson: (userId: string) =>
    request<{ revoked: number }>(`/admin/mcp/people/${userId}/revoke`, { method: "POST" }),

  listAudit: (params: { before?: string; action?: string; limit?: number }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    );
    return request<AuditEntry[]>(`/admin/audit?${qs}`);
  },

  /** Merged now if you can edit both; otherwise asks the target's owners. */
  mergeInitiative: (id: string, intoId: string) =>
    request<MergeOutcome>(`/initiatives/${id}/merge`, {
      method: "POST",
      body: JSON.stringify({ intoId }),
    }),
  listMergeRequests: (initiativeId: string) =>
    request<MergeRequest[]>(`/initiatives/${initiativeId}/merge-requests`),
  approveMergeRequest: (id: string) =>
    request<Initiative>(`/merge-requests/${id}/approve`, { method: "POST" }),
  declineMergeRequest: (id: string) =>
    request<void>(`/merge-requests/${id}/decline`, { method: "POST" }),
  withdrawMergeRequest: (id: string) =>
    request<void>(`/merge-requests/${id}/withdraw`, { method: "POST" }),
  listSignals: (id: string) => request<InitiativeSignal[]>(`/initiatives/${id}/signals`),
  /** Say (or say again, to confirm it's still needed) that your team needs this. */
  addSignal: (id: string, note: string) =>
    request<InitiativeSignal[]>(`/initiatives/${id}/signals`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  removeSignal: (id: string) =>
    request<InitiativeSignal[]>(`/initiatives/${id}/signals`, { method: "DELETE" }),

  assistInitiative: (
    body: {
      mode: "draft" | "improve";
      description?: string;
      title?: string;
      summary?: string;
      tags?: string[];
    },
    signal?: AbortSignal,
  ) =>
    request<InitiativeAssist>("/initiatives/assist", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  similar: (q: string) =>
    request<SimilarInitiative[]>(`/search/similar?q=${encodeURIComponent(q)}`),
  brief: (days: number, unit: string) =>
    request<PortfolioBrief>(
      `/reports/brief?days=${days}${unit ? `&unit=${encodeURIComponent(unit)}` : ""}`,
    ),
  briefSummary: (days: number, unit: string) =>
    request<BriefNarrative>("/reports/brief/summary", {
      method: "POST",
      body: JSON.stringify({ days, ...(unit ? { unit } : {}) }),
    }),
  llmStatus: () => request<LlmStatus>("/llm/status"),
  llmSettings: () => request<LlmAdminView>("/admin/llm"),
  saveLlmSettings: (settings: LlmSettings, secrets: LlmSecretsInput) =>
    request<LlmAdminView & { reindex: { reset: boolean; queued: number } }>("/admin/llm", {
      method: "PUT",
      body: JSON.stringify({ settings, secrets }),
    }),
  testLlmSettings: (settings: LlmSettings, secrets: LlmSecretsInput) =>
    request<LlmTestResult[]>("/admin/llm/test", {
      method: "POST",
      body: JSON.stringify({ settings, secrets }),
    }),
  rotateLlmSigningKey: () => request<LlmAdminView>("/admin/llm/signing-key", { method: "POST" }),
  llmUsage: (hours: number) => request<LlmUsageSummary>(`/admin/llm/usage?hours=${hours}`),
  reindexLlm: () => request<{ queued: number }>("/admin/llm/reindex", { method: "POST" }),
  resetLlmSettings: () => request<LlmAdminView>("/admin/llm", { method: "DELETE" }),

  listEdgesForInitiative: (initiativeId: string) =>
    request<Edge[]>(`/initiatives/${initiativeId}/edges`),
  /** Relationships touching any of these initiatives (at most 200). */
  listEdges: (initiativeIds: string[]) =>
    request<Edge[]>(`/edges?initiativeIds=${initiativeIds.map(encodeURIComponent).join(",")}`),
  /** Every team with work, and how their work connects (the graph's map). */
  graphOverview: () => request<GraphOverview>("/graph/overview"),
  /** One team's initiatives for the map, and every relationship touching them. */
  graphTeam: (teamId: string) =>
    request<GraphTeamDetail>(`/graph/teams/${encodeURIComponent(teamId)}`),
  createEdge: (dto: { fromInitiativeId: string; toInitiativeId: string; type: EdgeType }) =>
    request<Edge>("/edges", { method: "POST", body: JSON.stringify(dto) }),
  deleteEdge: (id: string) => request<void>(`/edges/${id}`, { method: "DELETE" }),

  listChatSessions: () => request<ChatSession[]>("/chat/sessions"),
  getChatSession: (id: string) =>
    request<{ session: ChatSession; messages: ChatMessage[] }>(`/chat/sessions/${id}`),
  createChatSession: () => request<ChatSession>("/chat/sessions", { method: "POST" }),
  postChatMessage: (sessionId: string, content: string) =>
    request<PostMessageResponse>(`/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  /** Ask Scry with the answer streamed in; resolves with the saved exchange. */
  streamChatMessage: (
    sessionId: string,
    content: string,
    onText: (delta: string) => void,
    onActivity?: (activity: ChatActivity) => void,
  ): Promise<PostMessageResponse> =>
    streamNdjson<ChatStreamEvent, PostMessageResponse>(
      `/chat/sessions/${sessionId}/messages/stream`,
      { content },
      (event) => {
        if (event.type === "delta") onText(event.text);
        if (event.type === "tool") {
          const { type: _type, ...activity } = event;
          onActivity?.(activity);
        }
        if (event.type === "error") throw new ApiError(502, event.message);
        return event.type === "done" ? event : undefined;
      },
    ),
  draftInitiative: (sessionId: string, signal?: AbortSignal) =>
    request<InitiativeDraft>(`/chat/sessions/${sessionId}/draft`, { method: "POST", signal }),
  registerFromChat: (sessionId: string, dto: InitiativeInput) =>
    request<Initiative>(`/chat/sessions/${sessionId}/register`, {
      method: "POST",
      body: JSON.stringify(dto),
    }),
  decideEvidence: (
    sessionId: string,
    messageId: string,
    dto: { initiativeId: string; decision: "linked" | "dismissed" | null; edgeType?: EdgeType },
  ) =>
    request<ChatMessage>(`/chat/sessions/${sessionId}/messages/${messageId}/evidence`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    }),
};

export function searchStreamUrl(q: string, topK = 10, expandHops = 1): string {
  const params = new URLSearchParams({ q, topK: String(topK), expandHops: String(expandHops) });
  return `${API_URL}/search/stream?${params}`;
}
