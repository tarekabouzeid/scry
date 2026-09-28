"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle } from "lucide-react";
import type { LlmRole, LlmUsageSummary } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { Skeleton } from "./ui/feedback";

const ROLE_LABEL: Record<LlmRole, string> = {
  embedding: "Embeddings",
  assistant: "Ask Scry assistant",
  tasks: "Tasks",
};

const WINDOWS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

const fmt = new Intl.NumberFormat();

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] text-subtle">{label}</p>
      <p className="font-mono text-sm text-foreground" title={hint}>
        {value}
      </p>
    </div>
  );
}

/** Fill in empty buckets so the strip shows gaps as gaps, not as squeezed-out time. */
function buckets(summary: LlmUsageSummary) {
  const step = summary.bucket === "hour" ? 3_600_000 : 86_400_000;
  const count = summary.bucket === "hour" ? 24 : Math.round(summary.hours / 24);
  const end = Math.floor(Date.now() / step) * step;
  const byTime = new Map(
    summary.series.map((s) => [Math.floor(Date.parse(s.at) / step) * step, s]),
  );
  return Array.from({ length: count }, (_, i) => {
    const at = end - (count - 1 - i) * step;
    const hit = byTime.get(at);
    return { at, calls: hit?.calls ?? 0, errors: hit?.errors ?? 0 };
  });
}

function ActivityStrip({ summary }: { summary: LlmUsageSummary }) {
  const data = buckets(summary);
  const max = Math.max(1, ...data.map((d) => d.calls));
  const label = (at: number) =>
    summary.bucket === "hour"
      ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <figure>
      <div className="mb-2 flex items-center justify-between text-[11px] text-subtle">
        <figcaption>Calls per {summary.bucket}</figcaption>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-accent" /> Succeeded
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-status-blocked" /> Failed
          </span>
        </span>
      </div>
      <div className="flex h-16 items-end gap-0.5 border-b border-border" role="list">
        {data.map((d) => {
          const ok = d.calls - d.errors;
          return (
            <div
              key={d.at}
              role="listitem"
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${label(d.at)} · ${fmt.format(d.calls)} call${d.calls === 1 ? "" : "s"}${d.errors ? `, ${fmt.format(d.errors)} failed` : ""}`}
              aria-label={`${label(d.at)}: ${d.calls} calls, ${d.errors} failed`}
            >
              {d.errors > 0 && (
                <div
                  className="w-full rounded-t-[3px] bg-status-blocked"
                  style={{ height: `${(d.errors / max) * 100}%`, marginBottom: ok ? 2 : 0 }}
                />
              )}
              {ok > 0 && (
                <div
                  className={cn(
                    "w-full bg-accent/80 transition-colors group-hover:bg-accent",
                    !d.errors && "rounded-t-[3px]",
                  )}
                  style={{ height: `${(ok / max) * 100}%` }}
                />
              )}
              <div className="absolute inset-0 rounded-xs group-hover:bg-foreground/4" />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-subtle">
        <span>{label(data[0]!.at)}</span>
        <span>now</span>
      </div>
    </figure>
  );
}

export function AiUsage() {
  const [hours, setHours] = useState(24);
  const { data, isLoading } = useQuery({
    queryKey: ["llm-usage", hours],
    queryFn: () => api.llmUsage(hours),
    refetchInterval: 30_000,
  });

  const roles = (["embedding", "assistant", "tasks"] as const).map(
    (role) =>
      data?.roles.find((r) => r.role === role) ?? {
        role,
        calls: 0,
        errors: 0,
        p50: null,
        p95: null,
        promptTokens: null,
        completionTokens: null,
        lastError: null,
      },
  );

  return (
    <section className="rounded-xl border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-accent">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Usage</h2>
            <p className="mt-0.5 text-xs text-muted">
              Every model call Scry made, from all api replicas. Tokens are as reported by the
              endpoint.
            </p>
          </div>
        </div>
        <div role="tablist" className="flex rounded-lg border border-border p-0.5 text-xs">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              role="tab"
              aria-selected={hours === w.hours}
              onClick={() => setHours(w.hours)}
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                hours === w.hours
                  ? "bg-elevated text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-5 p-5">
        {isLoading || !data ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <ActivityStrip summary={data} />
            <div className="grid gap-3 sm:grid-cols-3">
              {roles.map((r) => {
                const rate = r.calls ? r.errors / r.calls : 0;
                const tokens = (r.promptTokens ?? 0) + (r.completionTokens ?? 0);
                return (
                  <div
                    key={r.role}
                    className="rounded-lg border border-border bg-background/40 p-3"
                  >
                    <p className="text-xs font-medium text-foreground">{ROLE_LABEL[r.role]}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Stat label="Calls" value={fmt.format(r.calls)} />
                      <Stat
                        label="Failed"
                        value={
                          r.calls ? `${fmt.format(r.errors)} (${Math.round(rate * 100)}%)` : "—"
                        }
                      />
                      <Stat
                        label="Latency p50 / p95"
                        value={r.p50 !== null ? `${r.p50} / ${r.p95} ms` : "—"}
                      />
                      <Stat
                        label="Tokens"
                        value={tokens ? fmt.format(tokens) : "—"}
                        hint={
                          tokens
                            ? `${fmt.format(r.promptTokens ?? 0)} in, ${fmt.format(r.completionTokens ?? 0)} out`
                            : undefined
                        }
                      />
                    </div>
                    {r.lastError && (
                      <p className="mt-3 flex gap-1.5 rounded-md bg-status-blocked/10 px-2 py-1.5 text-[11px] text-status-blocked">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0 wrap-break-word">
                          Last failure {relativeTime(r.lastError.at)}: {r.lastError.message}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
