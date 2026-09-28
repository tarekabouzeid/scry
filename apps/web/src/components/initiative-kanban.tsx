"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { CalendarDays, CircleDot, GripVertical, Inbox, Users } from "lucide-react";
import {
  INITIATIVE_STATUSES,
  type Initiative,
  type InitiativeCount,
  type InitiativePage,
  type InitiativeStatus,
} from "@scry/shared";
import { api } from "@/lib/api";
import { canEditInitiative } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import {
  findCachedInitiative,
  queryKeys,
  useInitiativeCounts,
  useInitiativePages,
  useInvalidateInitiatives,
  useTeamLookup,
  useTeams,
} from "@/lib/queries";
import { STATUS_META, formatDate } from "@/lib/format";
import { StatusBadge, Tag, TierBadge } from "./ui/badge";
import { Avatar } from "./ui/avatar";
import { EmptyState, ErrorNote, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { SavedViewsMenu } from "./saved-views";
import { useWorkspace } from "./workspace";

type GroupBy = "status" | "team";

interface Lane {
  id: string;
  title: string;
  marker: React.ReactNode;
}

function InitiativeCard({
  initiative,
  teamName,
  showTeam,
  showStatus,
  selected,
  movable,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  initiative: Initiative;
  teamName: string;
  showTeam: boolean;
  showStatus: boolean;
  selected: boolean;
  /** You own it, so you can drag it to another lane. */
  movable: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Keyboard alternative to dragging: Alt+←/→ moves to the adjacent lane. */
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-initiative={initiative.id}
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", initiative.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (!movable || !e.altKey) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onMove(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
      title={movable ? "Drag to another lane, or press Alt+←/→" : undefined}
      className={cn(
        "focus-ring group relative w-full rounded-lg border bg-elevated/70 p-3 text-left shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-elevated",
        selected ? "border-accent/60 ring-1 ring-accent/30" : "border-border",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      {movable && (
        <GripVertical className="absolute right-1.5 top-2.5 h-3.5 w-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      {/* The team gets its own line so footers never wrap unevenly or cut names short. */}
      {showTeam && (
        <p className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-subtle">
          <Avatar id={initiative.teamId} name={teamName} size="xs" square />
          <span className="truncate">{teamName}</span>
        </p>
      )}
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {initiative.title}
      </p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
        {initiative.tldr ?? initiative.summary}
      </p>

      {initiative.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {initiative.tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          {initiative.tags.length > 3 && (
            <span className="text-[11px] text-subtle">+{initiative.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {showStatus && <StatusBadge status={initiative.status} />}
        <TierBadge tier={initiative.tier} />
        {initiative.targetDate && (
          <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
            <CalendarDays className="h-3 w-3" />
            {formatDate(initiative.targetDate)}
          </span>
        )}
      </div>
    </button>
  );
}

const LANE_PAGE = 50;
const NO_ITEMS: Initiative[] = [];

type Page = InfiniteData<InitiativePage, string | undefined>;

/** Each lane reads its own list: one status, or one team. */
function laneQuery(groupBy: GroupBy, laneId: string) {
  return groupBy === "status"
    ? { status: laneId, limit: LANE_PAGE }
    : { teamId: laneId, limit: LANE_PAGE };
}

/** Starts loading once it scrolls near the viewport (a board by team can have hundreds of lanes). */
function useNearViewport<T extends HTMLElement>(eager: boolean) {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near) return;
    if (!ref.current || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "0px 600px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}

function BoardLane({
  lane,
  groupBy,
  count,
  over,
  dragId,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  lane: Lane;
  groupBy: GroupBy;
  count: number | undefined;
  over: boolean;
  dragId: string | null;
  children: (items: Initiative[]) => React.ReactNode;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
}) {
  const [ref, near] = useNearViewport<HTMLElement>(groupBy === "status");
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInitiativePages(
    laneQuery(groupBy, lane.id),
    { enabled: near },
  );
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? NO_ITEMS, [data]);

  return (
    <section
      ref={ref}
      aria-label={lane.title}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex w-[85vw] max-w-72 shrink-0 snap-start flex-col rounded-xl border bg-surface/60 transition-colors sm:w-72",
        over ? "border-accent/60 bg-accent/6" : "border-border",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        {lane.marker}
        <p className="truncate text-sm font-medium text-foreground">{lane.title}</p>
        <span className="ml-auto rounded-md bg-elevated px-1.5 font-mono text-[11px] text-subtle">
          {count ?? items.length}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {(!near || isLoading) && <Skeleton className="h-24" />}
        {children(items)}
        {near && !isLoading && items.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border/80 py-6 text-xs text-subtle">
            <Inbox className="h-4 w-4" />
            {dragId && over ? "Drop here" : "Nothing here"}
          </div>
        )}
        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="focus-ring rounded-lg border border-dashed border-border py-2 text-xs text-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {isFetchingNextPage
              ? "Loading…"
              : `Show more${count !== undefined ? ` (${count - items.length} left)` : ""}`}
          </button>
        )}
      </div>
    </section>
  );
}

export function InitiativeKanban() {
  const { url, navigate, select, user } = useWorkspace();
  const selectedId = url.i;
  const onSelect = (initiative: Initiative) => select(initiative.id);
  const groupBy: GroupBy = url.group === "team" ? "team" : "status";
  const setGroupBy = (g: GroupBy) =>
    navigate({ group: g === "status" ? "" : g }, { replace: true });
  const { data: teams, isLoading: teamsLoading, error: teamsError } = useTeams();
  const teamOf = useTeamLookup();
  const {
    counts,
    data: countRows,
    isLoading: countsLoading,
    error: countsError,
  } = useInitiativeCounts(groupBy);
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);

  // Same rule as the API: owners and admins edit; only admins move teams.
  const canMove = (i: Initiative) =>
    groupBy === "team" ? user.role === "admin" : canEditInitiative(user, i);
  const laneOf = (i: Initiative) => (groupBy === "status" ? i.status : i.teamId);

  const move = useMutation({
    mutationFn: ({ id, lane }: { id: string; lane: string; undo?: boolean }) =>
      api.updateInitiative(
        id,
        groupBy === "status" ? { status: lane as InitiativeStatus } : { teamId: lane },
      ),
    // Optimistic: the card leaves its lane and lands on top of the new one
    // (lanes list the most recently updated first), and the counts follow.
    onMutate: async ({ id, lane }) => {
      const before = findCachedInitiative(queryClient, id);
      if (!before) return undefined;
      const from = laneOf(before);
      const fromKey = queryKeys.initiativeList(laneQuery(groupBy, from));
      const toKey = queryKeys.initiativeList(laneQuery(groupBy, lane));
      const countsKey = queryKeys.initiativeCounts(groupBy);
      await Promise.all(
        [fromKey, toKey, countsKey].map((queryKey) => queryClient.cancelQueries({ queryKey })),
      );
      const snapshot = {
        from: queryClient.getQueryData<Page>(fromKey),
        to: queryClient.getQueryData<Page>(toKey),
        counts: queryClient.getQueryData<InitiativeCount[]>(countsKey),
      };
      const moved: Initiative =
        groupBy === "status"
          ? { ...before, status: lane as InitiativeStatus }
          : { ...before, teamId: lane };
      queryClient.setQueryData<Page>(fromKey, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })),
            }
          : data,
      );
      queryClient.setQueryData<Page>(toKey, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p, n) => (n === 0 ? { ...p, items: [moved, ...p.items] } : p)),
            }
          : data,
      );
      queryClient.setQueryData<InitiativeCount[]>(countsKey, (rows) => {
        if (!rows) return rows;
        const next = rows.map((r) =>
          r.key === from
            ? { ...r, count: r.count - 1 }
            : r.key === lane
              ? { ...r, count: r.count + 1 }
              : r,
        );
        return next.some((r) => r.key === lane) ? next : [...next, { key: lane, count: 1 }];
      });
      return { from, keys: { fromKey, toKey, countsKey }, snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData(ctx.keys.fromKey, ctx.snapshot.from);
        queryClient.setQueryData(ctx.keys.toKey, ctx.snapshot.to);
        queryClient.setQueryData(ctx.keys.countsKey, ctx.snapshot.counts);
      }
      toast({ tone: "error", message: `Couldn't move it: ${err.message}` });
    },
    onSuccess: (updated, { undo }, ctx) => {
      if (undo || !ctx?.from) return;
      const to = lanes.find((l) => l.id === laneOf(updated));
      const from = ctx.from;
      toast({
        tone: "success",
        message: (
          <>
            Moved <strong>{updated.title}</strong> to {to?.title ?? "another lane"}
          </>
        ),
        action: {
          label: "Undo",
          onClick: () => move.mutate({ id: updated.id, lane: from, undo: true }),
        },
      });
    },
    onSettled: () => invalidate(),
  });

  const drop = (id: string, lane: string) => {
    const i = findCachedInitiative(queryClient, id);
    if (!i || laneOf(i) === lane || !canMove(i)) return;
    move.mutate({ id, lane });
  };

  const lanes = useMemo<Lane[]>(() => {
    if (groupBy === "status") {
      return INITIATIVE_STATUSES.map((s) => ({
        id: s,
        title: STATUS_META[s].label,
        marker: <span className={cn("h-2 w-2 rounded-full", STATUS_META[s].dot)} />,
      }));
    }
    return (teams ?? []).map((t) => ({
      id: t.id,
      title: t.name,
      marker: <Avatar id={t.id} name={t.name} size="sm" square />,
    }));
  }, [groupBy, teams]);

  // The card remounts in its new lane after a keyboard move; keep focus on it.
  const refocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = refocusRef.current;
    const el = id && document.querySelector<HTMLElement>(`[data-initiative="${id}"]`);
    if (el && el !== document.activeElement) {
      refocusRef.current = null;
      el.focus();
    }
  });

  const loading = countsLoading || (groupBy === "team" && teamsLoading);
  const loadError = countsError ?? (groupBy === "team" ? teamsError : null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 pt-5 sm:px-6">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(
            [
              { id: "status", label: "By status", icon: CircleDot },
              { id: "team", label: "By team", icon: Users },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setGroupBy(id)}
              className={cn(
                "focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                groupBy === id
                  ? "bg-elevated text-foreground shadow-card"
                  : "text-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">{counts.total} initiatives</p>
        <div className="ml-auto">
          <SavedViewsMenu />
        </div>
      </div>

      {loadError && (
        <ErrorNote className="mx-6 mt-4">
          Couldn&apos;t load the board: {loadError.message}
        </ErrorNote>
      )}

      <div className="flex min-h-0 flex-1 snap-x scroll-px-4 gap-3 overflow-x-auto p-4 pt-4 sm:scroll-px-6 sm:p-6 sm:pt-4">
        {loading &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-72 shrink-0 space-y-2 rounded-xl border border-border p-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ))}

        {!loading && lanes.length === 0 && (
          <EmptyState
            className="flex-1"
            icon={<Users className="h-5 w-5" />}
            title="No teams yet"
            description="Teams appear here once someone creates one during onboarding."
          />
        )}

        {!loading &&
          lanes.map((lane, laneIndex) => (
            <BoardLane
              key={`${groupBy}:${lane.id}`}
              lane={lane}
              groupBy={groupBy}
              count={countRows ? counts.of(lane.id) : undefined}
              over={overLane === lane.id}
              dragId={dragId}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overLane !== lane.id) setOverLane(lane.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverLane(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                setOverLane(null);
                setDragId(null);
                if (id) drop(id, lane.id);
              }}
            >
              {(items) =>
                items.map((initiative) => (
                  <InitiativeCard
                    key={initiative.id}
                    movable={canMove(initiative)}
                    dragging={dragId === initiative.id}
                    onDragStart={() => setDragId(initiative.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverLane(null);
                    }}
                    onMove={(dir) => {
                      const next = lanes[laneIndex + dir];
                      if (!next) return;
                      refocusRef.current = initiative.id;
                      drop(initiative.id, next.id);
                    }}
                    initiative={initiative}
                    teamName={teamOf(initiative.teamId)?.name ?? "Unknown team"}
                    showTeam={groupBy === "status"}
                    showStatus={groupBy === "team"}
                    selected={selectedId === initiative.id}
                    onSelect={() => onSelect(initiative)}
                  />
                ))
              }
            </BoardLane>
          ))}
      </div>
    </div>
  );
}
