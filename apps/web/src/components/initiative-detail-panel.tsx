"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BellOff,
  CalendarClock,
  CalendarDays,
  Clock,
  ExternalLink,
  GitBranch,
  GitMerge,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  Plus,
  Search,
  Send,
  Tags,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { ActivityEntry, EdgeType, Initiative } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePref } from "@/lib/prefs";
import { useDebounced } from "@/lib/use-debounced";
import { canEditInitiative, canRelateInitiative } from "@/lib/permissions";
import {
  findCachedInitiative,
  queryKeys,
  useInitiativePage,
  useInitiativesById,
  useInvalidateInitiatives,
  useLlmStatus,
  useOverlapsFor,
  useTeamLookup,
  useUserLookup,
} from "@/lib/queries";
import {
  EDGE_LABEL,
  STATUS_META,
  formatDate,
  formatDateTime,
  postedTime,
  relativeTime,
} from "@/lib/format";
import { linkTo } from "@/lib/url-state";
import { StatusBadge, Tag, TierBadge } from "./ui/badge";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/form";
import { Tabs } from "./ui/tabs";
import { MenuItem, Popover } from "./ui/popover";
import { Dialog } from "./ui/dialog";
import { useToast } from "./ui/toast";
import { ErrorNote, Skeleton, Spinner } from "./ui/feedback";
import { useWorkspace } from "./workspace";
import {
  MergeDialog,
  MergedBanner,
  MergeRequestsBanner,
  SignalsSection,
} from "./merge-and-signals";

const canEditInitiativeUi = canEditInitiative;
const canRelate = canRelateInitiative;

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span className="flex w-24 shrink-0 items-center gap-2 text-subtle">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 text-foreground">{children}</span>
    </div>
  );
}

function SectionTitle({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">
        {icon}
        {children}
      </p>
      {action}
    </div>
  );
}

const EDGE_TYPES = Object.keys(EDGE_LABEL) as EdgeType[];

/**
 * Pick another team's initiative + relationship type; creates the edge from
 * `from`. Relationships only connect different teams (the API enforces it).
 */
const NO_MATCHES: Initiative[] = [];

function AddRelationship({ from, onDone }: { from: Initiative; onDone: () => void }) {
  const teamOf = useTeamLookup();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const [type, setType] = useState<EdgeType>("builds_on");
  const [query, setQuery] = useState("");

  const search = useDebounced(query.trim());
  // Only other teams' live work can be related; the api filters, so a busy
  // team's own matches can't crowd the results out.
  const { data: found } = useInitiativePage({
    search,
    notTeamId: from.teamId,
    unmerged: true,
    limit: 8,
  });
  const matches = found?.items ?? NO_MATCHES;

  const create = useMutation({
    mutationFn: (toId: string) =>
      api.createEdge({ fromInitiativeId: from.id, toInitiativeId: toId, type }),
    onSuccess: async () => {
      await invalidate();
      toast({ tone: "success", message: "Relationship added" });
      onDone();
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted">This initiative</span>
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as EdgeType)}
          className="flex-1"
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {EDGE_LABEL[t].outgoing.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-1.5 text-xs text-subtle">{EDGE_LABEL[type].hint}</p>
      <Input
        autoFocus
        className="mt-2"
        icon={<Search className="h-4 w-4" />}
        placeholder="Find another team's initiative…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="mt-2 max-h-56 overflow-y-auto">
        {matches.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate(i.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated disabled:opacity-50"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_META[i.status].dot)} />
              <span className="min-w-0 flex-1 truncate text-foreground">{i.title}</span>
              <span className="shrink-0 truncate text-[11px] text-subtle">
                {teamOf(i.teamId)?.name}
              </span>
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="px-2 py-2 text-xs text-subtle">No matches.</li>}
      </ul>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function OverlapCards({ initiative }: { initiative: Initiative }) {
  const ids = useMemo(() => [initiative.id], [initiative.id]);
  const overlaps = useOverlapsFor(ids).get(initiative.id) ?? [];
  const initiativeOf = useInitiativesById(
    overlaps.map((o) => (o.initiativeAId === initiative.id ? o.initiativeBId : o.initiativeAId)),
  );
  const teamOf = useTeamLookup();
  const invalidate = useInvalidateInitiatives();
  const { select, user } = useWorkspace();
  const toast = useToast();
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  // A merge already asked for from this card waits for the other side.
  const { data: mergeRequests } = useQuery({
    queryKey: queryKeys.mergeRequests(initiative.id),
    queryFn: () => api.listMergeRequests(initiative.id),
    enabled: overlaps.length > 0,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, relatedTo }: { id: string; relatedTo?: string }) => {
      // Creating the edge resolves the overlap as "linked" server-side.
      if (relatedTo) {
        await api.createEdge({
          fromInitiativeId: initiative.id,
          toInitiativeId: relatedTo,
          type: "related",
        });
      } else {
        await api.resolveOverlap(id, "dismissed");
      }
    },
    onSuccess: async (_d, vars) => {
      await invalidate();
      toast({
        tone: "success",
        message: vars.relatedTo ? "Marked as related" : "Marked as not a duplicate",
      });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  if (overlaps.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-border p-5">
      {overlaps.map((o) => {
        const otherId = o.initiativeAId === initiative.id ? o.initiativeBId : o.initiativeAId;
        const other = initiativeOf(otherId);
        const canResolve = canRelate(user, initiative) || canRelate(user, other);
        return (
          <div key={o.id} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              Possible overlap · {Math.round(o.score * 100)}% similar
            </p>
            <button
              type="button"
              onClick={() => select(otherId)}
              className="mt-1.5 block text-left text-sm font-medium text-foreground hover:text-accent"
            >
              {other?.title ?? "Another initiative"}
            </button>
            {other && <p className="text-xs text-subtle">{teamOf(other.teamId)?.name}</p>}
            {canResolve ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  onClick={() => resolve.mutate({ id: o.id, relatedTo: otherId })}
                  disabled={resolve.isPending}
                  title="Different work, but the two teams should know about each other"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Related, not the same
                </Button>
                {canEditInitiativeUi(user, initiative) &&
                  (mergeRequests?.some(
                    (r) => r.source.id === initiative.id && r.target.id === otherId,
                  ) ? (
                    <span className="inline-flex items-center gap-1.5 px-2 text-xs text-subtle">
                      <GitMerge className="h-3.5 w-3.5" />
                      Merge asked; waiting for them
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => setMergeTarget(otherId)}>
                      <GitMerge className="h-3.5 w-3.5" />
                      Merge into it
                    </Button>
                  ))}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: o.id })}
                >
                  Not a duplicate
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-subtle">
                Either team can mark this as related, merge it or dismiss it.
              </p>
            )}
          </div>
        );
      })}
      <MergeDialog
        source={initiative}
        initialTargetId={mergeTarget ?? undefined}
        open={mergeTarget !== null}
        onClose={() => setMergeTarget(null)}
      />
    </div>
  );
}

function describeActivity(entry: ActivityEntry): ReactNode {
  const d = entry.data as Record<string, string | number | string[] | undefined>;
  switch (entry.kind) {
    case "created":
      return "created this initiative";
    case "registered_from_chat":
      return "registered this from an Ask Scry conversation";
    case "status_changed":
      return (
        <>
          moved it from{" "}
          <strong>{STATUS_META[d.from as keyof typeof STATUS_META]?.label ?? d.from}</strong> to{" "}
          <strong>{STATUS_META[d.to as keyof typeof STATUS_META]?.label ?? d.to}</strong>
        </>
      );
    case "updated":
      return `edited ${(d.fields as string[] | undefined)?.join(", ") ?? "details"}`;
    case "edge_added":
    case "edge_removed": {
      const meta = EDGE_LABEL[d.type as EdgeType];
      const label = d.direction === "incoming" ? meta?.incoming : meta?.outgoing;
      return (
        <>
          {entry.kind === "edge_added" ? "added" : "removed"} “{label?.toLowerCase()}{" "}
          <strong>{d.otherTitle}</strong>”
        </>
      );
    }
    case "commented":
      return "commented";
    case "overlap_detected":
      return `flagged a possible overlap (${Math.round(Number(d.score) * 100)}% similar)`;
    case "merged_into":
      return (
        <>
          merged this into <strong>{d.otherTitle}</strong>
        </>
      );
    case "merged_from":
      return (
        <>
          merged <strong>{d.otherTitle}</strong>
          {d.otherTeam ? ` (${d.otherTeam})` : ""} into this
        </>
      );
    case "merge_requested":
      return d.direction === "into" ? (
        <>
          asked {d.otherTeam ?? "the other team"} to merge this into <strong>{d.otherTitle}</strong>
        </>
      ) : (
        <>
          asked to merge <strong>{d.otherTitle}</strong>
          {d.otherTeam ? ` (${d.otherTeam})` : ""} into this
        </>
      );
    case "merge_declined":
      return (
        <>
          declined merging this into <strong>{d.otherTitle}</strong>
        </>
      );
    case "signal_added":
      return (
        <>
          said <strong>{d.teamName ?? "their team"}</strong> needs this too
        </>
      );
    default:
      return entry.kind;
  }
}

function Discussion({ initiativeId }: { initiativeId: string }) {
  const { user, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState("");
  const { data: comments, isLoading } = useQuery({
    queryKey: queryKeys.comments(initiativeId),
    queryFn: () => api.listComments(initiativeId),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(initiativeId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(initiativeId) }),
    ]);
  const post = useMutation({
    mutationFn: () => api.createComment(initiativeId, body.trim()),
    onSuccess: async () => {
      setBody("");
      await refresh();
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const remove = useMutation({
    mutationFn: api.deleteComment,
    onSuccess: refresh,
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  return (
    <div className="space-y-3">
      {isLoading && <Skeleton className="h-14" />}
      {comments?.length === 0 && (
        <p className="text-xs text-subtle">
          No comments yet. Found overlap with your team&apos;s work? Say hello here.
        </p>
      )}
      {comments?.map((c) => (
        <div key={c.id} className="group flex gap-2.5">
          <Avatar id={c.authorId} name={c.authorName ?? "?"} size="sm" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2 text-xs">
              <span className="font-medium text-foreground">{c.authorName ?? "Someone"}</span>
              <time
                dateTime={c.createdAt}
                title={formatDateTime(c.createdAt)}
                className="text-subtle"
              >
                {postedTime(c.createdAt)}
              </time>
              {(c.authorId === user.id || user.role === "admin") && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  onClick={() => remove.mutate(c.id)}
                  className="ml-auto text-subtle opacity-0 hover:text-status-blocked group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-sm text-foreground">
              {c.body}
            </p>
          </div>
        </div>
      ))}
      {!canWrite ? (
        <p className="text-xs text-subtle">You can comment once a team admin lets you in.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim() && !post.isPending) post.mutate();
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (body.trim()) post.mutate();
              }
            }}
            placeholder="Add a comment… (⌘/Ctrl + Enter to send)"
            className="min-h-[60px]"
          />
          <Button
            type="submit"
            variant="primary"
            size="icon"
            disabled={!body.trim() || post.isPending}
            aria-label="Send comment"
          >
            {post.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </form>
      )}
    </div>
  );
}

function History({ initiativeId }: { initiativeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.activity(initiativeId),
    queryFn: () => api.listActivity(initiativeId),
  });
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data?.length) return <p className="text-xs text-subtle">No history yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {data.map((entry) => (
        <li key={entry.id} className="relative text-sm">
          <span className="absolute left-[-21px] top-1.5 h-2 w-2 rounded-full border border-border-strong bg-elevated" />
          <p className="text-muted">
            <span className="font-medium text-foreground">{entry.actorName ?? "Scry"}</span>{" "}
            {describeActivity(entry)}
          </p>
          <p className="text-[11px] text-subtle" title={formatDateTime(entry.createdAt)}>
            {relativeTime(entry.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

function SubscribeButton({ initiativeId }: { initiativeId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: subs } = useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: api.subscriptions,
  });
  const existing = subs?.find(
    (s) => s.targetType === "initiative" && s.targetValue === initiativeId,
  );
  const toggle = useMutation({
    mutationFn: async () => {
      if (existing) await api.unsubscribe(existing.id);
      else await api.subscribe("initiative", initiativeId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });
      toast({
        tone: "success",
        message: existing ? "You'll no longer get updates" : "You'll be notified of changes",
      });
    },
  });
  const Icon = existing ? BellOff : Bell;
  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      title={existing ? "Unfollow" : "Follow for updates"}
      aria-label={existing ? "Unfollow" : "Follow for updates"}
      className={cn(
        "focus-ring flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-elevated",
        existing ? "text-accent" : "text-subtle hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const PANEL_DEFAULT = 432; // 27rem
const PANEL_MIN = 360;
const panelMax = () => Math.max(PANEL_MIN, Math.min(820, Math.round(window.innerWidth * 0.6)));

/**
 * Drag handle on the panel's left edge (md and up). Also a keyboard-operable
 * separator: ←/→ resize, Home resets; double-click resets too.
 */
function PanelResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const onMove = (ev: PointerEvent) => onChange(clamp(startW + (startX - ev.clientX)));
        const onUp = () => {
          setDragging(false);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
      onDoubleClick={() => onChange(PANEL_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") onChange(clamp(width + step));
        else if (e.key === "ArrowRight") onChange(clamp(width - step));
        else if (e.key === "Home") onChange(PANEL_DEFAULT);
        else return;
        e.preventDefault();
      }}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize outline-hidden md:block"
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent",
          dragging && "bg-accent",
        )}
      />
    </div>
  );
}

/** The AI-written one-liner: what it is and where it stands. */
function Tldr({ initiative, aiOff }: { initiative: Initiative; aiOff: boolean }) {
  if (!initiative.tldr) {
    // Written in the background a few seconds after a change.
    const fresh = Date.now() - Date.parse(initiative.updatedAt) < 45_000;
    if (aiOff || !fresh || initiative.mergedIntoId) return null;
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-subtle">
        <Spinner className="h-3 w-3 text-subtle" />
        Writing a TL;DR…
      </p>
    );
  }
  return (
    <div
      className="mt-3 rounded-lg border-l-2 border-accent/60 bg-accent/5 px-3 py-2"
      title="Written by AI from the summary, status and relationships. It updates when those change."
    >
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
        <Sparkles className="h-3 w-3" />
        TL;DR
      </p>
      <p className="text-sm leading-snug text-foreground">{initiative.tldr}</p>
    </div>
  );
}

export function InitiativeDetailPanel({
  initiativeId,
  onSelect,
  onClose,
}: {
  initiativeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { user, openEdit } = useWorkspace();
  const teamOf = useTeamLookup();
  const userOf = useUserLookup();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const queryClient = useQueryClient();
  const cached = findCachedInitiative(queryClient, initiativeId);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"discussion" | "history">("discussion");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const aiOff = useLlmStatus().data?.configured === false;
  const {
    data: initiative,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.initiative(initiativeId),
    queryFn: () => api.getInitiative(initiativeId),
    // Render instantly from the list cache; the fetch just refreshes it.
    placeholderData: cached,
    // Poll while background AI work is pending: the embedding (so the
    // indexing notice clears) and, for a short while after a change, the
    // TL;DR — edits that don't touch its inputs never rewrite it.
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d || aiOff) return false;
      if (d.embeddingReady === false) return 3000;
      const tldrPending = !d.tldr || (d.tldrAt ?? "") < d.updatedAt;
      return tldrPending && Date.now() - Date.parse(d.updatedAt) < 45_000 ? 3000 : false;
    },
  });
  const { data: edges, isLoading: edgesLoading } = useQuery({
    queryKey: queryKeys.edgesFor(initiativeId),
    queryFn: () => api.listEdgesForInitiative(initiativeId),
  });
  const initiativeOf = useInitiativesById(
    (edges ?? []).map((e) =>
      e.fromInitiativeId === initiativeId ? e.toInitiativeId : e.fromInitiativeId,
    ),
  );

  const removeEdge = useMutation({
    mutationFn: api.deleteEdge,
    onSuccess: async () => {
      await invalidate();
      toast({ tone: "success", message: "Relationship removed" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteInitiative(initiativeId),
    onSuccess: async () => {
      onClose();
      await invalidate();
      toast({ tone: "success", message: "Initiative deleted" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  const team = initiative ? teamOf(initiative.teamId) : undefined;
  const contact = initiative ? userOf(initiative.contactPerson) : undefined;
  const submitter = initiative ? userOf(initiative.submittedBy) : undefined;
  const isOwner = canEditInitiative(user, initiative);
  const canDelete = !!initiative && (user.role === "admin" || initiative.submittedBy === user.id);
  const [merging, setMerging] = useState(false);
  // Merging is only for a flagged duplicate, so the menu offers it only then.
  const panelIds = useMemo(() => [initiativeId], [initiativeId]);
  const flaggedCount = (useOverlapsFor(panelIds).get(initiativeId) ?? []).length;
  const [panelWidth, setPanelWidth] = usePref("scry-panel-width", PANEL_DEFAULT);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkTo({ view: "table", i: initiativeId }));
      toast({ tone: "success", message: "Link copied" });
    } catch {
      toast({ tone: "error", message: "Couldn't access the clipboard" });
    }
  };

  return (
    <aside
      aria-label="Initiative details"
      // Re-clamped on render so a narrower window never gets a panel wider than 60%.
      style={{ "--panel-w": `${Math.min(panelWidth, panelMax())}px` } as CSSProperties}
      className="fixed inset-0 z-30 flex flex-col bg-surface animate-slide-in-right print:hidden md:relative md:inset-auto md:z-auto md:h-screen md:w-(--panel-w) md:shrink-0 md:border-l md:border-border md:bg-surface/95 md:shadow-pop md:backdrop-blur-sm"
    >
      <PanelResizer width={panelWidth} onChange={setPanelWidth} />
      <div className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-border px-3 pl-5">
        <p className="text-xs font-medium uppercase tracking-wider text-subtle">Initiative</p>
        <div className="flex items-center gap-0.5">
          <SubscribeButton initiativeId={initiativeId} />
          {initiative && isOwner && (
            <button
              type="button"
              onClick={() => openEdit(initiative)}
              title="Edit"
              aria-label="Edit"
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <Popover
            className="w-44 p-1"
            trigger={({ toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-label="More actions"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  onClick={() => (close(), void copyLink())}
                >
                  Copy link
                </MenuItem>
                {isOwner && !initiative?.mergedIntoId && flaggedCount > 0 && (
                  <MenuItem
                    icon={<GitMerge className="h-3.5 w-3.5" />}
                    onClick={() => (close(), setMerging(true))}
                  >
                    Merge into…
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem
                    tone="danger"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => (close(), setConfirmDelete(true))}
                  >
                    Delete…
                  </MenuItem>
                )}
              </>
            )}
          </Popover>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && !initiative && (
          <ErrorNote className="m-5">Couldn&apos;t load this initiative: {error.message}</ErrorNote>
        )}

        {isLoading && !initiative && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="mt-6 h-32" />
          </div>
        )}

        {initiative && (
          <div className="animate-fade-in">
            <MergedBanner initiative={initiative} />
            <MergeRequestsBanner initiative={initiative} />
            <div className="border-b border-border p-5">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={initiative.status} />
                <TierBadge tier={initiative.tier} />
                {initiative.embeddingReady === false &&
                  (aiOff ? (
                    <span
                      title="No AI model is connected, so it isn't indexed for semantic search or overlap detection yet. An admin can connect one in Admin → AI & models."
                      className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-subtle"
                    >
                      Not indexed
                    </span>
                  ) : (
                    <span
                      title="Being embedded for semantic search — it won't show up in Ask Scry or graph search for a few seconds."
                      className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted"
                    >
                      <Spinner className="h-3 w-3" />
                      Indexing
                    </span>
                  ))}
              </div>
              <h2 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
                {initiative.title}
              </h2>
              {initiative.status === "on_hold" && initiative.holdReason && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                  <PauseCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>On hold: {initiative.holdReason}</span>
                </p>
              )}
              <Tldr initiative={initiative} aiOff={aiOff} />
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {initiative.summary}
              </p>
            </div>

            <OverlapCards initiative={initiative} />

            <div className="divide-y divide-border/60 border-b border-border px-5 py-1">
              <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="Team">
                <span className="flex items-center gap-2">
                  <Avatar id={initiative.teamId} name={team?.name ?? "?"} size="sm" square />
                  <span className="truncate">{team?.name ?? "Unknown team"}</span>
                </span>
              </MetaRow>
              <MetaRow icon={<UserRound className="h-3.5 w-3.5" />} label="Contact">
                {contact ? (
                  <span className="flex items-center gap-2">
                    <Avatar id={contact.id} name={contact.name} size="sm" />
                    <span className="truncate">{contact.name}</span>
                    <a
                      href={`mailto:${contact.email}?subject=${encodeURIComponent(initiative.title)}`}
                      title={contact.email}
                      aria-label={`Email ${contact.name}`}
                      className="ml-auto text-subtle hover:text-accent"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </a>
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </MetaRow>
              {initiative.startDate && (
                <MetaRow icon={<CalendarDays className="h-3.5 w-3.5" />} label="Start">
                  {formatDate(initiative.startDate)}
                </MetaRow>
              )}
              {initiative.targetDate && (
                <MetaRow icon={<CalendarClock className="h-3.5 w-3.5" />} label="Target">
                  {formatDate(initiative.targetDate)}
                </MetaRow>
              )}
              <MetaRow icon={<Clock className="h-3.5 w-3.5" />} label="Updated">
                <span title={new Date(initiative.updatedAt).toLocaleString()}>
                  {relativeTime(initiative.updatedAt)}
                  {submitter && <span className="text-subtle"> · added by {submitter.name}</span>}
                </span>
              </MetaRow>
              {initiative.externalLink && (
                <MetaRow icon={<ExternalLink className="h-3.5 w-3.5" />} label="Link">
                  <a
                    href={initiative.externalLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline"
                  >
                    <span className="truncate">
                      {initiative.externalLink.replace(/^https?:\/\//, "")}
                    </span>
                    <ArrowUpRight className="h-3 w-3 shrink-0" />
                  </a>
                </MetaRow>
              )}
            </div>

            <SignalsSection initiative={initiative} />

            {initiative.tags.length > 0 && (
              <div className="border-b border-border p-5">
                <SectionTitle icon={<Tags className="h-3 w-3" />}>Tags</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {initiative.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
              </div>
            )}

            <div className="border-b border-border p-5">
              <SectionTitle
                icon={<GitBranch className="h-3 w-3" />}
                action={
                  !adding &&
                  canRelate(user, initiative) && (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-elevated hover:text-foreground"
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </button>
                  )
                }
              >
                Other teams&apos; work {edges ? `· ${edges.length}` : ""}
              </SectionTitle>
              {adding && <AddRelationship from={initiative} onDone={() => setAdding(false)} />}
              {edgesLoading && <Skeleton className="h-14" />}
              {edges && edges.length === 0 && !adding && (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-subtle">
                  Not connected to other teams&apos; work yet. Add what this builds on, replaces or
                  relates to, so those teams know.
                </p>
              )}
              {edges && edges.length > 0 && (
                <ul className={cn("flex flex-col gap-1.5", adding && "mt-3")}>
                  {edges.map((edge) => {
                    const outgoing = edge.fromInitiativeId === initiative.id;
                    const otherId = outgoing ? edge.toInitiativeId : edge.fromInitiativeId;
                    const other = initiativeOf(otherId);
                    const meta = EDGE_LABEL[edge.type as EdgeType];
                    const Arrow = outgoing ? ArrowUpRight : ArrowDownLeft;
                    const canRemove =
                      edge.createdBy === user.id ||
                      canRelate(user, initiative) ||
                      canRelate(user, other);
                    return (
                      <li key={edge.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => onSelect(otherId)}
                          className="focus-ring flex w-full items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5 pr-9 text-left transition-colors hover:border-border-strong hover:bg-elevated"
                        >
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                            style={{ background: `${meta?.hex ?? "#888"}1f`, color: meta?.hex }}
                          >
                            <Arrow className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className="block text-[11px] font-medium"
                              style={{ color: meta?.hex }}
                            >
                              {meta ? (outgoing ? meta.outgoing : meta.incoming) : edge.type}
                            </span>
                            <span className="block truncate text-sm text-foreground group-hover:text-accent">
                              {other?.title ?? "Unknown initiative"}
                            </span>
                            {other && (
                              <span className="block truncate text-[11px] text-subtle">
                                {teamOf(other.teamId)?.name}
                              </span>
                            )}
                          </span>
                          {other && <StatusBadge status={other.status} />}
                        </button>
                        {canRemove && (
                          <button
                            type="button"
                            aria-label="Remove relationship"
                            title="Remove relationship"
                            disabled={removeEdge.isPending}
                            onClick={() => removeEdge.mutate(edge.id)}
                            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle opacity-0 transition-opacity hover:bg-status-blocked/10 hover:text-status-blocked focus:opacity-100 group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="p-5 pt-3">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "discussion", label: "Discussion" },
                  { id: "history", label: "History" },
                ]}
                className="mb-4"
              />
              {tab === "discussion" ? (
                <Discussion initiativeId={initiative.id} />
              ) : (
                <History initiativeId={initiative.id} />
              )}
            </div>
          </div>
        )}
      </div>

      {initiative && (
        <MergeDialog source={initiative} open={merging} onClose={() => setMerging(false)} />
      )}
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this initiative?"
        description="Its relationships, comments and history are deleted too. This can't be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground">{initiative?.title}</p>
      </Dialog>
    </aside>
  );
}
