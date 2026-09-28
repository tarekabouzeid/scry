"use client";

import { useCallback, useMemo } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import type { Initiative, InitiativePage, Overlap, Team, User } from "@scry/shared";
import { api, ApiError, type InitiativeFilters, type InitiativeListQuery } from "./api";

/** Drop empty filters so the same view always makes the same cache key. */
function compact<T extends object>(query: T): T {
  return Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as T;
}

export const queryKeys = {
  teams: ["teams"] as const,
  /** A list followed page by page ("Load more", board lanes). */
  initiativeList: (query: InitiativeListQuery) => ["initiatives", "list", compact(query)] as const,
  /** Just the first page (pickers, the command palette, the timeline). */
  initiativePage: (query: InitiativeListQuery) => ["initiatives", "page", compact(query)] as const,
  initiativeCounts: (groupBy: "status" | "team", filters: InitiativeFilters = {}) =>
    ["initiatives", "counts", groupBy, compact(filters)] as const,
  initiative: (id: string) => ["initiative", id] as const,
  graphOverview: ["graph", "overview"] as const,
  graphTeam: (teamId: string) => ["graph", "team", teamId] as const,
  edgesFor: (id: string) => ["edges", id] as const,
  chatSessions: ["chat-sessions"] as const,
  chatSession: (id: string) => ["chat-session", id] as const,
  users: ["users"] as const,
  overlaps: ["overlaps"] as const,
  activity: (id: string) => ["activity", id] as const,
  comments: (id: string) => ["comments", id] as const,
  notifications: ["notifications"] as const,
  subscriptions: ["subscriptions"] as const,
  tags: ["tags"] as const,
  tokens: ["tokens"] as const,
  llmStatus: ["llm-status"] as const,
  brief: (days: number, unit: string) => ["brief", days, unit] as const,
  signals: (id: string) => ["signals", id] as const,
  mergeRequests: (id: string) => ["merge-requests", id] as const,
  mcpConnections: ["mcp-connections"] as const,
  mcpAdmin: ["mcp-admin"] as const,
  mcpCalls: (userId: string) => ["mcp-calls", userId] as const,
  llmSettings: ["llm-settings"] as const,
};

/** Everything an initiative mutation can make stale. */
export const INITIATIVE_KEYS = [
  ["initiatives"],
  ["initiative"],
  ["graph"],
  ["edges"],
  ["activity"],
  ["overlaps"],
  ["signals"],
  ["merge-requests"],
  ["tags"],
] as const;

export function useUsers() {
  return useQuery({ queryKey: queryKeys.users, queryFn: api.listUsers, staleTime: 60_000 });
}

export function useUserLookup() {
  const { data } = useUsers();
  return useMemo(() => {
    const byId = new Map<string, User>((data ?? []).map((u) => [u.id, u]));
    return (id: string) => byId.get(id);
  }, [data]);
}

/** The strongest open overlaps (the api caps it at 100), for reviewing them. */
export function useOverlaps() {
  return useQuery({ queryKey: queryKeys.overlaps, queryFn: api.listOverlaps });
}

/** How many overlaps are open in all (the list above is capped). */
export function useOverlapCount() {
  const { data } = useQuery({
    queryKey: [...queryKeys.overlaps, "count"],
    queryFn: api.countOverlaps,
  });
  return data?.open ?? 0;
}

function indexOverlaps(list: Overlap[] | undefined) {
  const index = new Map<string, Overlap[]>();
  for (const o of list ?? []) {
    for (const id of [o.initiativeAId, o.initiativeBId]) {
      index.set(id, [...(index.get(id) ?? []), o]);
    }
  }
  return index;
}

/** initiativeId -> open overlaps involving it, among the strongest (review mode). */
export function useOverlapIndex() {
  const { data } = useOverlaps();
  return useMemo(() => indexOverlaps(data), [data]);
}

/**
 * initiativeId -> every open overlap involving it, for the initiatives on
 * screen (asked in chunks of 200, the api's limit).
 */
export function useOverlapsFor(ids: string[]) {
  const key = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const { data } = useQuery({
    queryKey: [...queryKeys.overlaps, "for", key],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < key.length; i += 200) chunks.push(key.slice(i, i + 200));
      const found = (await Promise.all(chunks.map((c) => api.listOverlapsFor(c)))).flat();
      // A pair split across two chunks comes back twice.
      return [...new Map(found.map((o) => [o.id, o])).values()];
    },
    enabled: key.length > 0,
    placeholderData: (previous) => previous,
  });
  return useMemo(() => indexOverlaps(data), [data]);
}

/** Tags already used on initiatives, most used first — the organisation's vocabulary. */
export function useTagsInUse() {
  return useQuery({
    queryKey: queryKeys.tags,
    queryFn: api.tags,
    select: (rows) => rows.map((r) => r.tag),
    staleTime: 60_000,
  });
}

export function useTeams() {
  return useQuery({ queryKey: queryKeys.teams, queryFn: api.listTeams });
}

export function useTeamLookup() {
  const { data: teams } = useTeams();
  return useMemo(() => {
    const byId = new Map<string, Team>((teams ?? []).map((t) => [t.id, t]));
    return (teamId: string) => byId.get(teamId);
  }, [teams]);
}

/**
 * A list read page by page. Nothing in the app loads every initiative: the
 * register can hold a million.
 */
export function useInitiativePages(
  query: Omit<InitiativeListQuery, "cursor">,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: queryKeys.initiativeList(query),
    queryFn: ({ pageParam }) => api.listInitiatives({ ...query, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Only the first page of a list: search pickers and the like. */
export function useInitiativePage(
  query: Omit<InitiativeListQuery, "cursor">,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.initiativePage(query),
    queryFn: () => api.listInitiatives(query),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** How many initiatives match, per status or team, as a lookup plus the total. */
export function useInitiativeCounts(groupBy: "status" | "team", filters: InitiativeFilters = {}) {
  const query = useQuery({
    queryKey: queryKeys.initiativeCounts(groupBy, filters),
    queryFn: () => api.countInitiatives(groupBy, compact(filters)),
    placeholderData: keepPreviousData,
  });
  const counts = useMemo(() => {
    const byKey = new Map((query.data ?? []).map((c) => [c.key, c.count]));
    const total = (query.data ?? []).reduce((sum, c) => sum + c.count, 0);
    return { of: (key: string) => byKey.get(key) ?? 0, total };
  }, [query.data]);
  return { ...query, counts };
}

// --- Initiatives by id ------------------------------------------------------

type Waiting = { resolve: (i: Initiative) => void; reject: (err: unknown) => void };
let batch: Map<string, Waiting[]> | null = null;

/**
 * Everything asked for by id in the same tick goes out as one /lookup call
 * (200 ids at a time), so a list of linked work costs one request, not one
 * per row. An id that doesn't exist (any more) fails like GET /:id would.
 */
function loadInitiative(id: string): Promise<Initiative> {
  return new Promise((resolve, reject) => {
    if (!batch) {
      batch = new Map();
      setTimeout(flushBatch, 0);
    }
    batch.set(id, [...(batch.get(id) ?? []), { resolve, reject }]);
  });
}

async function flushBatch() {
  const current = batch;
  batch = null;
  if (!current) return;
  const ids = [...current.keys()];
  const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) =>
    ids.slice(i * 200, i * 200 + 200),
  );
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const found = new Map((await api.lookupInitiatives(chunk)).map((i) => [i.id, i]));
        for (const id of chunk) {
          const initiative = found.get(id);
          for (const w of current.get(id) ?? []) {
            if (initiative) w.resolve(initiative);
            else w.reject(new ApiError(404, "Initiative not found"));
          }
        }
      } catch (err) {
        for (const id of chunk) for (const w of current.get(id) ?? []) w.reject(err);
      }
    }),
  );
}

/**
 * Look up initiatives by id — linked work, overlaps, followed items. Shares
 * the per-initiative cache with the detail panel.
 */
export function useInitiativesById(ids: readonly (string | null | undefined)[]) {
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(",");
  const unique = useMemo(() => (key ? key.split(",") : []), [key]);
  const data = useQueries({
    queries: unique.map((id) => ({
      queryKey: queryKeys.initiative(id),
      queryFn: () => loadInitiative(id),
      staleTime: 30_000,
      retry: false,
    })),
    combine: (results) => ({
      data: results.map((r) => r.data),
      isLoading: results.some((r) => r.isPending),
    }),
  });
  // `data` is a fresh array every render; keep the lookup stable until what's
  // in it actually changes.
  const signature =
    data.data
      .map((i) => (i ? `${i.id}:${i.updatedAt}:${i.tldrAt}:${i.signalTeams}` : "-"))
      .join(",") + (data.isLoading ? ":loading" : "");
  return useMemo(() => {
    const byId = new Map<string, Initiative>();
    for (const i of data.data) if (i) byId.set(i.id, i);
    return Object.assign(
      (id: string | null | undefined) => (id ? byId.get(id) : undefined),
      /** Some are still on their way. */
      { isLoading: data.isLoading },
    );
  }, [signature]);
}

/** An initiative from any list already on screen, to render before its own fetch lands. */
export function findCachedInitiative(queryClient: QueryClient, id: string): Initiative | undefined {
  // Freshest list first: an inactive list (the table, left for the board)
  // isn't refetched on invalidate and still holds the old copy.
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ["initiatives"] })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of queries) {
    const data = query.state.data as InitiativePage | InfiniteData<InitiativePage> | undefined;
    if (!data || typeof data !== "object") continue;
    const pages = "pages" in data ? data.pages : "items" in data ? [data] : [];
    for (const page of pages) {
      const hit = page.items.find((i) => i.id === id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Refetch every view that shows initiatives, edges, history or overlaps. */
export function useInvalidateInitiatives() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        INITIATIVE_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [...key] })),
      ),
    [queryClient],
  );
}

/** Whether AI features (Ask Scry, semantic search, overlap detection) are available. */
export function useLlmStatus() {
  return useQuery({ queryKey: queryKeys.llmStatus, queryFn: api.llmStatus, staleTime: 30_000 });
}
