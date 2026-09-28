"use client";

import { useState } from "react";
import { Bookmark, BookmarkPlus, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePref } from "@/lib/prefs";
import type { UrlState } from "@/lib/url-state";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover } from "./ui/popover";
import { VIEWS } from "./sidebar";
import { useWorkspace } from "./workspace";

/** The parts of the URL that make up a "view": where you are and how it's filtered. */
const VIEW_KEYS = [
  "view",
  "q",
  "team",
  "status",
  "tier",
  "sort",
  "dir",
  "group",
  "days",
  "unit",
] as const;
type ViewState = Pick<UrlState, (typeof VIEW_KEYS)[number]>;

export interface SavedView {
  id: string;
  name: string;
  state: ViewState;
}

function pick(url: UrlState): ViewState {
  return {
    view: url.view,
    q: url.q,
    team: url.team,
    status: url.status,
    tier: url.tier,
    sort: url.sort,
    dir: url.dir,
    group: url.group,
    days: url.days,
    unit: url.unit,
  };
}

function same(a: ViewState, b: ViewState) {
  return VIEW_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}

/** Saved views are per person and per browser — a personal shortcut list. */
export function useSavedViews() {
  const { user, url, navigate } = useWorkspace();
  const [views, setViews] = usePref<SavedView[]>(`scry-views:${user.id}`, []);
  const current = pick(url);
  return {
    views,
    activeId: views.find((v) => same(v.state, current))?.id ?? null,
    save: (name: string) =>
      setViews([
        ...views,
        { id: Math.random().toString(36).slice(2, 10), name: name.trim(), state: current },
      ]),
    remove: (id: string) => setViews(views.filter((v) => v.id !== id)),
    apply: (v: SavedView) => navigate({ ...v.state, tab: "" }),
  };
}

export function describeView(state: ViewState): string {
  const view = VIEWS.find((v) => v.id === state.view)?.label ?? "Initiatives";
  const filters = [
    state.q && `“${state.q}”`,
    state.team && "team",
    state.status,
    state.tier,
    state.unit,
    state.days && (state.days === "0" ? "all time" : `${state.days} days`),
  ]
    .filter(Boolean)
    .join(", ");
  return filters ? `${view} · ${filters.replace(/_/g, " ")}` : view;
}

/** Toolbar button: save the current filters as a named view, or switch to one. */
export function SavedViewsMenu() {
  const { views, activeId, save, remove, apply } = useSavedViews();
  const [name, setName] = useState("");
  const active = views.find((v) => v.id === activeId);

  return (
    <Popover
      className="w-72 p-1.5"
      trigger={({ toggle, open }) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={toggle}
          aria-expanded={open}
          className={cn(active && "text-foreground")}
        >
          <Bookmark className={cn("h-3.5 w-3.5", active && "fill-current text-accent")} />
          <span className="max-w-36 truncate">{active ? active.name : "Views"}</span>
        </Button>
      )}
    >
      {(close) => (
        <div className="space-y-1">
          {views.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted">
              Save the current view and filters to get back to them in one click. They also appear
              in the sidebar.
            </p>
          )}
          {views.map((v) => (
            <div key={v.id} className="group flex items-center gap-1 rounded-md hover:bg-elevated">
              <button
                type="button"
                onClick={() => (apply(v), close())}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-accent">
                  {v.id === activeId && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{v.name}</span>
                  <span className="block truncate text-[11px] text-subtle">
                    {describeView(v.state)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(v.id)}
                aria-label={`Delete view ${v.name}`}
                title="Delete view"
                className="focus-ring mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 hover:text-status-blocked focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!activeId && (
            <form
              className="flex gap-1.5 border-t border-border/70 p-1 pt-2 first:border-t-0 first:pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                save(name);
                setName("");
              }}
            >
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this view…"
                aria-label="View name"
                maxLength={60}
                className="h-8 flex-1 text-xs"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
                <BookmarkPlus className="h-3.5 w-3.5" />
                Save
              </Button>
            </form>
          )}
        </div>
      )}
    </Popover>
  );
}
