"use client";

import { useCallback, useSyncExternalStore } from "react";

export const VIEW_IDS = [
  "table",
  "kanban",
  "timeline",
  "graph",
  "brief",
  "chat",
  "settings",
  "team",
  "admin",
] as const;
export type ViewMode = (typeof VIEW_IDS)[number];

/**
 * Everything worth sharing as a link lives in the query string:
 * ?view=table&i=<initiative>&chat=<session>&q=…&team=…&status=…&tier=…&sort=…&dir=…&group=…&tab=…
 */
export interface UrlState {
  view: ViewMode;
  /** Selected initiative (detail panel). */
  i: string | null;
  /** Active chat session. */
  chat: string | null;
  q: string;
  team: string;
  status: string;
  tier: string;
  /** Initiatives table order (InitiativeSort) and direction; empty = the default. */
  sort: string;
  dir: string;
  group: string;
  /** Sub-tab within a view (e.g. admin: people | teams | ai). */
  tab: string;
  /** Brief: period in days ("0" = all time) and org unit. */
  days: string;
  unit: string;
}

const DEFAULTS: UrlState = {
  view: "table",
  i: null,
  chat: null,
  q: "",
  team: "",
  status: "",
  tier: "",
  sort: "",
  dir: "",
  group: "",
  tab: "",
  days: "",
  unit: "",
};

const EVENT = "scry:urlchange";

function read(search: string): UrlState {
  const p = new URLSearchParams(search);
  const view = p.get("view");
  return {
    view: (VIEW_IDS as readonly string[]).includes(view ?? "") ? (view as ViewMode) : "table",
    i: p.get("i"),
    chat: p.get("chat"),
    q: p.get("q") ?? "",
    team: p.get("team") ?? "",
    status: p.get("status") ?? "",
    tier: p.get("tier") ?? "",
    sort: p.get("sort") ?? "",
    dir: p.get("dir") ?? "",
    group: p.get("group") ?? "",
    tab: p.get("tab") ?? "",
    days: p.get("days") ?? "",
    unit: p.get("unit") ?? "",
  };
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const getSnapshot = () => window.location.search;
const getServerSnapshot = () => "";

// Cache the parsed object per search string so consumers get a stable reference.
let cachedSearch: string | null = null;
let cachedState: UrlState = DEFAULTS;

export function useUrlState(): [
  UrlState,
  (patch: Partial<UrlState>, options?: { replace?: boolean }) => void,
] {
  const search = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedState = read(search);
  }

  const update = useCallback((patch: Partial<UrlState>, options?: { replace?: boolean }) => {
    const next = { ...read(window.location.search), ...patch };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== DEFAULTS[key as keyof UrlState]) params.set(key, String(value));
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    // Navigation (view / selection) gets history entries; typing in filters doesn't.
    if (options?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [cachedState, update];
}

/** Absolute link to the current app with the given state — for "copy link". */
export function linkTo(patch: Partial<UrlState>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, String(value));
  }
  return `${window.location.origin}${window.location.pathname}?${params}`;
}
