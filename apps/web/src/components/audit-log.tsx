"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  FileUp,
  KeyRound,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AuditEntry } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { EmptyState, ErrorNote, Skeleton, Spinner } from "./ui/feedback";

const PAGE = 50;

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "ai.settings_saved", label: "AI settings saved" },
  { value: "ai.settings_removed", label: "AI settings removed" },
  { value: "ai.signing_key_rotated", label: "Signing key rotated" },
  { value: "ai.reindexed", label: "Re-indexed" },
  { value: "user.role_changed", label: "Role changes" },
  { value: "user.team_changed", label: "People moved between teams" },
  { value: "team.created", label: "Teams created" },
  { value: "team.updated", label: "Teams renamed or edited" },
  { value: "team.merged", label: "Teams merged" },
  { value: "team.joined", label: "People joined a team" },
  { value: "team.requested", label: "New teams asked for" },
  { value: "team.approved", label: "New teams approved" },
  { value: "team.declined", label: "New teams declined" },
  { value: "team.join_requested", label: "Asked to join a team" },
  { value: "team.member_approved", label: "Let into a team" },
  { value: "team.member_declined", label: "Declined to join" },
  { value: "team.member_removed", label: "Removed from a team" },
  { value: "team.admin_granted", label: "Made team admin" },
  { value: "team.admin_revoked", label: "Team admin removed" },
  { value: "token.created", label: "API tokens created" },
  { value: "token.revoked", label: "API tokens revoked" },
  { value: "initiatives.imported", label: "Imports" },
  { value: "initiatives.merged", label: "Initiatives merged" },
  { value: "mcp.enabled", label: "AI tools turned on" },
  { value: "mcp.disabled", label: "AI tools turned off" },
  { value: "mcp.connections_revoked", label: "AI tools disconnected" },
];

const ACTION_LABEL = new Map(FILTERS.filter((f) => f.value).map((f) => [f.value, f.label]));

const ICONS: Record<string, LucideIcon> = {
  ai: Bot,
  user: ShieldCheck,
  team: Users,
  token: KeyRound,
  initiatives: FileUp,
};

function Details({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return null;
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg border border-border bg-background/60 p-3 font-mono text-[11px] sm:grid-cols-[max-content_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-subtle">{k}</dt>
          <dd className="break-all text-foreground">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[entry.action.split(".")[0]!] ?? ScrollText;
  const hasDetails = Object.keys(entry.data).length > 0;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {entry.actor ? (
          <Avatar name={entry.actor.name} id={entry.actor.id} size="sm" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated text-subtle">
            <ScrollText className="h-3 w-3" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">{entry.summary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
            <span className="inline-flex items-center gap-1">
              <Icon className="h-3 w-3" />
              <span title={entry.action}>{ACTION_LABEL.get(entry.action) ?? entry.action}</span>
            </span>
            <span title={new Date(entry.createdAt).toLocaleString()}>
              {relativeTime(entry.createdAt)}
            </span>
          </p>
          {open && <Details data={entry.data} />}
        </div>
        {hasDetails && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Hide details" : "Show details"}
            onClick={() => setOpen((o) => !o)}
            className="focus-ring rounded-md p-1 text-subtle hover:bg-elevated hover:text-foreground"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </button>
        )}
      </div>
    </li>
  );
}

export function AuditLog() {
  const [action, setAction] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["audit", action],
    queryFn: ({ pageParam }) => api.listAudit({ action, before: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => {
      const tail = last[last.length - 1];
      return last.length === PAGE && tail ? `${tail.createdAt}_${tail.id}` : undefined;
    },
  });
  const entries = query.data?.pages.flat() ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Changes to AI settings, roles, teams, API tokens and imports — who did what, and when.
        </p>
        <Select
          filter
          aria-label="Filter by action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="sm:w-64"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      {query.error && <ErrorNote>{query.error.message}</ErrorNote>}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="Nothing recorded yet"
            description={
              action ? "No entries of this kind." : "Admin and security changes will show up here."
            }
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {entries.map((e) => (
              <AuditRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage && <Spinner className="h-3.5 w-3.5" />}
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
