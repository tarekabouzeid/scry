import type { EdgeType, InitiativeStatus, InitiativeTier } from "@scry/shared";

export const STATUS_META: Record<
  InitiativeStatus,
  { label: string; dot: string; badge: string; hex: string }
> = {
  idea: {
    label: "Idea",
    dot: "bg-status-idea",
    badge: "bg-status-idea/10 text-status-idea ring-status-idea/20",
    hex: "#a1a1b5",
  },
  planned: {
    label: "Planned",
    dot: "bg-status-planned",
    badge: "bg-status-planned/10 text-status-planned ring-status-planned/20",
    hex: "#60a5fa",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-status-progress",
    badge: "bg-status-progress/10 text-status-progress ring-status-progress/25",
    hex: "#a78bfa",
  },
  on_hold: {
    label: "On hold",
    dot: "bg-warning",
    badge: "bg-warning/10 text-warning ring-warning/25",
    hex: "#f59e0b",
  },
  shipped: {
    label: "Shipped",
    dot: "bg-status-shipped",
    badge: "bg-status-shipped/10 text-status-shipped ring-status-shipped/25",
    hex: "#34d399",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-status-cancelled",
    badge: "bg-status-cancelled/10 text-status-cancelled ring-status-cancelled/20 line-through",
    hex: "#71717a",
  },
};

export const TIER_LABEL: Record<InitiativeTier, string> = {
  strategic: "Strategic",
  tactical: "Tactical",
};

/**
 * How a relationship reads from each end: "A builds on B" / "B is built on by A".
 * They say which teams should know about each other, never what waits on what.
 */
export const EDGE_LABEL: Record<
  EdgeType,
  { outgoing: string; incoming: string; hex: string; hint: string }
> = {
  builds_on: {
    outgoing: "Builds on",
    incoming: "Built on by",
    hex: "#60a5fa",
    hint: "Your work plans to use theirs.",
  },
  replaces: {
    outgoing: "Replaces",
    incoming: "Replaced by",
    hex: "#a78bfa",
    hint: "Your work takes over from theirs.",
  },
  related: {
    outgoing: "Related to",
    incoming: "Related to",
    hex: "#a1a1b5",
    hint: "Worth knowing about each other; no direction.",
  },
};

// Clearly distinct hues (lime and blue sat too close to emerald and indigo).
const TEAM_HUES = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-orange-400",
  "from-rose-500 to-pink-400",
  "from-fuchsia-500 to-purple-500",
  "from-orange-600 to-red-500",
];

// FNV-1a with a final mix. The previous `h * 31 + c` barely mixed the low
// bits used by `% length`, so most ids landed on the same one or two hues.
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** A stable gradient per id, so a team/person keeps its color everywhere. */
export function gradientFor(id: string): string {
  return TEAM_HUES[hash(id) % TEAM_HUES.length]!;
}

// Same hues as TEAM_HUES, for canvas drawing (graph team clusters).
const TEAM_HEX = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#d946ef", "#ea580c"];

/** The solid color matching gradientFor(id). */
export function hexFor(id: string): string {
  return TEAM_HEX[hash(id) % TEAM_HEX.length]!;
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Full local date and time, e.g. for a tooltip on a relative time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * When something was posted: "today at 14:32" on the same calendar day
 * (a bare "3 hours ago" hides when in the day it was), relative before that.
 */
export function postedTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) {
    return `today at ${at.toLocaleTimeString(undefined, { timeStyle: "short" })}`;
  }
  return relativeTime(iso);
}

/** Date-only columns (YYYY-MM-DD) — format without a timezone shift. */
export function formatDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
