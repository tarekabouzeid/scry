"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZap, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Button } from "./ui/button";
import { ErrorNote, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";

/** A call's arguments in a few words: the question, the id, the filters. */
function describeInput(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const text = parts.join(" · ");
  return text.length > 140 ? `${text.slice(0, 139)}…` : text || "—";
}

/**
 * Admin → AI tools: the switch for the read-only MCP server, who uses it
 * from which tools, and every call (kept for the retention period).
 */
export function McpAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [person, setPerson] = useState<string>("");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.mcpAdmin,
    queryFn: api.mcpAdmin,
  });
  const { data: calls } = useQuery({
    queryKey: queryKeys.mcpCalls(person),
    queryFn: () => api.mcpCalls(person || undefined),
    enabled: !!data,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpAdmin }),
      queryClient.invalidateQueries({ queryKey: ["mcp-calls"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnections }),
    ]);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setMcpEnabled(enabled),
    onSuccess: async ({ enabled }) => {
      await refresh();
      toast({ tone: "success", message: enabled ? "AI tools can connect" : "AI tools turned off" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const revoke = useMutation({
    mutationFn: api.revokeMcpPerson,
    onSuccess: async ({ revoked }) => {
      await refresh();
      toast({
        tone: "success",
        message: revoked
          ? `Disconnected ${revoked} AI tool${revoked === 1 ? "" : "s"}`
          : "Nothing was connected",
      });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (isLoading || !data) return <Skeleton className="h-40" />;
  const personName = data.people.find((p) => p.user.id === person)?.user.name;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PlugZap className="h-4 w-4 text-accent" />
              Connecting AI tools (MCP)
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  data.enabled
                    ? "bg-status-shipped/10 text-status-shipped"
                    : "bg-elevated text-muted",
                )}
              >
                {data.enabled ? "On" : "Off"}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted">
              People can ask Scry from Claude, Cursor, VS Code and other AI tools, signed in as
              themselves and read only. What Scry returns goes to that tool&apos;s AI provider, so
              decide whether that&apos;s acceptable here. Every call is logged below for{" "}
              {data.retentionDays} days.
            </p>
            <p className="mt-2 text-xs text-subtle">
              Address: <code className="font-mono">{data.url}</code>
            </p>
          </div>
          <Button
            variant={data.enabled ? "ghost" : "primary"}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!data.enabled)}
          >
            {data.enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface shadow-card">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          Who uses it
        </h2>
        {data.people.length === 0 ? (
          <p className="px-5 py-4 text-sm text-subtle">
            Nobody has asked Scry from an AI tool yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {data.people.map((p) => (
              <li key={p.user.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">
                    {p.user.name} <span className="text-subtle">· {p.user.email}</span>
                  </p>
                  <p className="text-[11px] text-subtle">
                    {p.calls} call{p.calls === 1 ? "" : "s"} from {p.clients.join(", ")} · last{" "}
                    {relativeTime(p.lastCallAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={person === p.user.id}
                  onClick={() => setPerson(person === p.user.id ? "" : p.user.id)}
                >
                  {person === p.user.id ? "All calls" : "Their calls"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(p.user.id)}
                  className="text-status-blocked hover:text-status-blocked"
                  title="Sign out every AI tool they connected. Their API tokens are separate."
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface shadow-card">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">
          {personName ? `${personName}'s calls` : "Recent calls"}
        </h2>
        {!calls ? (
          <Skeleton className="m-5 h-16" />
        ) : calls.length === 0 ? (
          <p className="px-5 py-4 text-sm text-subtle">No calls yet.</p>
        ) : (
          <ul aria-label="MCP calls" className="divide-y divide-border/70">
            {calls.map((c) => (
              <li key={c.id} className="px-5 py-2.5 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2 text-foreground">
                  <span className="font-mono text-xs">{c.tool}</span>
                  <span className="text-xs text-muted">
                    {c.user.name} via {c.client}
                    {c.via === "token" ? " (API token)" : ""}
                  </span>
                  <span className="ml-auto text-[11px] text-subtle">
                    {relativeTime(c.createdAt)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-subtle">
                  {describeInput(c.input)} ·{" "}
                  {c.ok
                    ? `${c.resultIds.length} initiative${c.resultIds.length === 1 ? "" : "s"}`
                    : "failed"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
