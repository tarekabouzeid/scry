"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, PlugZap, Unplug } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-subtle">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground">
          {value}
        </code>
        <Button
          size="sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast({ tone: "error", message: "Couldn't access the clipboard; copy it by hand" });
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Settings → AI tools: how to connect an assistant or coding agent to
 * Scry's read-only MCP server, and the ones connected as you.
 */
export function McpConnectionsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.mcpConnections,
    queryFn: api.mcpConnections,
  });
  const disconnect = useMutation({
    mutationFn: api.disconnectMcp,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpConnections });
      toast({ tone: "success", message: "Disconnected" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  if (isLoading || !data) return <Skeleton className="h-24" />;
  if (!data.enabled) {
    return (
      <p className="text-sm text-muted">
        An admin hasn&apos;t turned this on yet. Once they do, you can ask Scry from Claude, Cursor,
        VS Code and other AI tools.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Add Scry as a remote (HTTP) MCP server in your AI tool. The first time, it opens Scry so you
        can sign in and allow read access. It can&apos;t change anything.
      </p>
      <div className="grid gap-3">
        <CopyField label="Server address" value={data.url} />
        <CopyField label="Claude Code" value={`claude mcp add --transport http scry ${data.url}`} />
      </div>
      <p className="text-xs text-subtle">
        A tool that can&apos;t sign in this way can use a read-only API token (below) as{" "}
        <code className="font-mono">Authorization: Bearer …</code>.
      </p>

      <div>
        <p className="mb-2 text-xs font-medium text-foreground">Connected as you</p>
        {data.connections.length === 0 ? (
          <p className="text-xs text-subtle">No AI tools yet.</p>
        ) : (
          <ul className="divide-y divide-border/70 rounded-lg border border-border">
            {data.connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <PlugZap className="h-4 w-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{c.client}</p>
                  <p className="text-[11px] text-subtle">
                    Connected {relativeTime(c.createdAt)} ·{" "}
                    {c.lastUsedAt ? `last used ${relativeTime(c.lastUsedAt)}` : "not used yet"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => disconnect.mutate(c.id)}
                  disabled={disconnect.isPending}
                  className="text-status-blocked hover:text-status-blocked"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
