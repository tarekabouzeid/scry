"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import type { Initiative } from "@scry/shared";
import { cn } from "@/lib/cn";
import { useInitiativePages, useOverlapsFor, useTeams } from "@/lib/queries";
import { STATUS_META, formatDate } from "@/lib/format";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { EmptyState, ErrorNote, Skeleton } from "./ui/feedback";
import { useWorkspace } from "./workspace";

const DAY = 86_400_000;
const SPANS = { 6: "6 months", 12: "1 year", 24: "2 years" } as const;
type Span = keyof typeof SPANS;

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : null;
}

/** YYYY-MM-DD in UTC, as the api takes dates. */
function isoDay(t: number) {
  return new Date(t).toISOString().slice(0, 10);
}

function startOfMonth(t: number, offsetMonths = 0) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1);
}

interface Bar {
  initiative: Initiative;
  start: number;
  end: number;
  /** Only a target date — rendered as a milestone. */
  milestone: boolean;
  /** Only a start date — open-ended. */
  openEnded: boolean;
}

/** Greedy interval packing so bars in a lane never overlap visually. */
function pack(bars: Bar[]): Bar[][] {
  const rows: Bar[][] = [];
  for (const bar of [...bars].sort((a, b) => a.start - b.start)) {
    const row = rows.find((r) => r[r.length - 1]!.end + 2 * DAY < bar.start);
    if (row) row.push(bar);
    else rows.push([bar]);
  }
  return rows;
}

export function TimelineView() {
  const { url, select } = useWorkspace();
  const { data: teams } = useTeams();
  const [span, setSpan] = useState<Span>(12);
  const [offset, setOffset] = useState(0);
  const [hideDone, setHideDone] = useState(true);

  const windowStart = startOfMonth(Date.now(), -2 + offset);
  const windowEnd = startOfMonth(windowStart, span);
  // Only dated work that touches the window, soonest target first.
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInitiativePages({
      from: isoDay(windowStart),
      to: isoDay(windowEnd),
      sort: "target",
      limit: 200,
    });
  const initiatives = useMemo(() => data?.pages.flatMap((p) => p.items), [data]);
  const shownIds = useMemo(() => (initiatives ?? []).map((i) => i.id), [initiatives]);
  const overlapIndex = useOverlapsFor(shownIds);
  const months = useMemo(
    () => Array.from({ length: span }, (_, i) => startOfMonth(windowStart, i)),
    [windowStart, span],
  );
  const pct = (t: number) => ((t - windowStart) / (windowEnd - windowStart)) * 100;

  const { lanes } = useMemo(() => {
    const bars: Bar[] = [];
    for (const i of initiatives ?? []) {
      if (hideDone && (i.status === "shipped" || i.status === "cancelled")) continue;
      const s = parseDate(i.startDate);
      const t = parseDate(i.targetDate);
      if (s === null && t === null) continue;
      const start = s ?? t!;
      const end = t ?? Math.max(start + 60 * DAY, Date.now());
      if (end < windowStart || start > windowEnd) continue;
      bars.push({ initiative: i, start, end, milestone: s === null, openEnded: t === null });
    }
    const lanes = (teams ?? [])
      .map((team) => ({ team, rows: pack(bars.filter((b) => b.initiative.teamId === team.id)) }))
      .filter((l) => l.rows.length > 0);
    return { lanes };
  }, [initiatives, teams, hideDone, windowStart, windowEnd]);

  // An overlap is a *collision* when the two initiatives' date ranges also intersect.
  const collisions = useMemo(() => {
    const ranges = new Map<string, [number, number]>();
    for (const l of lanes)
      for (const r of l.rows) for (const b of r) ranges.set(b.initiative.id, [b.start, b.end]);
    const hit = new Set<string>();
    for (const [id, [s, e]] of ranges) {
      for (const o of overlapIndex.get(id) ?? []) {
        const other = o.initiativeAId === id ? o.initiativeBId : o.initiativeAId;
        const r = ranges.get(other);
        if (r && r[0] <= e && s <= r[1]) hit.add(id);
      }
    }
    return hit;
  }, [lanes, overlapIndex]);

  const today = Date.now();

  if (error)
    return <ErrorNote className="m-6">Couldn&apos;t load the timeline: {error.message}</ErrorNote>;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {(Object.keys(SPANS) as unknown as Span[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(Number(s) as Span)}
              className={cn(
                "focus-ring rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                span === Number(s)
                  ? "bg-elevated text-foreground shadow-card"
                  : "text-muted hover:text-foreground",
              )}
            >
              {SPANS[s]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Earlier"
            onClick={() => setOffset((o) => o - Math.max(1, span / 4))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            Today
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Later"
            onClick={() => setOffset((o) => o + Math.max(1, span / 4))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => setHideDone(e.target.checked)}
            className="h-3.5 w-3.5 accent-[rgb(var(--accent))]"
          />
          Hide shipped & cancelled
        </label>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-subtle">
          {collisions.size > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              {collisions.size} overlapping in time
            </span>
          )}
          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="font-medium text-foreground hover:underline disabled:opacity-50"
            >
              {isFetchingNextPage ? "Loading…" : `${initiatives?.length ?? 0} shown · Show more`}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : lanes.length === 0 ? (
        <EmptyState
          icon={<CalendarRange className="h-5 w-5" />}
          title="Nothing scheduled in this window"
          description="Initiatives appear here once they have a start or target date. Edit an initiative to add dates."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <div className="min-w-[760px]">
            {/* Month header */}
            <div className="sticky top-0 z-10 flex border-b border-border bg-elevated/60 backdrop-blur-sm">
              <div className="w-44 shrink-0 border-r border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
                Team
              </div>
              <div className="relative flex flex-1">
                {months.map((m) => (
                  <div
                    key={m}
                    className="flex-1 border-r border-border/60 px-2 py-2 text-[11px] text-subtle last:border-r-0"
                  >
                    {new Date(m).toLocaleDateString(undefined, {
                      month: "short",
                      ...(new Date(m).getUTCMonth() === 0 || m === months[0]
                        ? { year: "2-digit" }
                        : {}),
                      timeZone: "UTC",
                    })}
                  </div>
                ))}
              </div>
            </div>

            {lanes.map(({ team, rows }) => (
              <div key={team.id} className="flex border-b border-border/70 last:border-b-0">
                <div className="flex w-44 shrink-0 items-start gap-2 border-r border-border px-3 py-3">
                  <Avatar id={team.id} name={team.name} size="sm" square />
                  {/* Wraps rather than truncating: "Identity & Security" must stay readable. */}
                  <span
                    className="line-clamp-2 text-sm leading-snug text-foreground"
                    title={team.name}
                  >
                    {team.name}
                  </span>
                </div>
                <div className="relative flex-1 py-2">
                  {/* Month gridlines */}
                  <div className="pointer-events-none absolute inset-0 flex">
                    {months.map((m) => (
                      <div key={m} className="flex-1 border-r border-border/40 last:border-r-0" />
                    ))}
                  </div>
                  {today >= windowStart && today <= windowEnd && (
                    <div
                      className="pointer-events-none absolute inset-y-0 w-px bg-accent/70"
                      style={{ left: `${pct(today)}%` }}
                    />
                  )}
                  {rows.map((row, r) => (
                    <div key={r} className="relative h-9">
                      {row.map((bar) => {
                        const i = bar.initiative;
                        const meta = STATUS_META[i.status];
                        const left = Math.max(0, pct(bar.start));
                        const right = Math.min(100, pct(bar.end));
                        const selected = url.i === i.id;
                        const collides = collisions.has(i.id);
                        const title = `${i.title}\n${i.startDate ? formatDate(i.startDate) : "?"} → ${i.targetDate ? formatDate(i.targetDate) : "open-ended"}`;
                        if (bar.milestone) {
                          return (
                            <button
                              key={i.id}
                              type="button"
                              title={title}
                              onClick={() => select(i.id)}
                              className="focus-ring absolute top-1.5 flex h-6 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-md px-1 text-xs text-foreground hover:bg-elevated"
                              style={{ left: `${pct(bar.start)}%` }}
                            >
                              <Diamond
                                className="h-3.5 w-3.5 shrink-0"
                                style={{ color: meta.hex, fill: meta.hex }}
                              />
                              <span className="max-w-48 truncate">{i.title}</span>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={i.id}
                            type="button"
                            title={title}
                            onClick={() => select(i.id)}
                            className={cn(
                              "focus-ring absolute top-1.5 flex h-6 items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left text-xs text-foreground transition-all hover:brightness-110",
                              selected && "ring-2 ring-accent",
                              collides && !selected && "ring-2 ring-warning/70",
                            )}
                            style={{
                              left: `${left}%`,
                              width: `max(${right - left}%, 1.75rem)`,
                              background: bar.openEnded
                                ? `linear-gradient(90deg, ${meta.hex}40, ${meta.hex}08)`
                                : `${meta.hex}33`,
                              borderColor: `${meta.hex}80`,
                            }}
                          >
                            {collides && (
                              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
                            )}
                            <span className="truncate">{i.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
