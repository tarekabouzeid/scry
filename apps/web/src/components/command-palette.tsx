"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, MessagesSquare, Plus, Search, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useInitiativePage, useTeamLookup, useTeams } from "@/lib/queries";
import { useDebounced } from "@/lib/use-debounced";
import { STATUS_META } from "@/lib/format";
import { Avatar } from "./ui/avatar";
import { Kbd } from "./ui/feedback";
import { VIEWS } from "./sidebar";
import { useWorkspace } from "./workspace";
import { queueQuestion } from "@/lib/ask";

interface Command {
  id: string;
  group: "Actions" | "Initiatives" | "Teams" | "Go to" | "Ask Scry";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

const GROUPS: Command["group"][] = ["Actions", "Initiatives", "Teams", "Go to", "Ask Scry"];

/** Cheap fuzzy score: all query words must appear; earlier / prefix matches rank higher. */
function score(haystack: string, query: string): number {
  const h = haystack.toLowerCase();
  let total = 0;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = h.indexOf(word);
    if (at === -1) return -1;
    total += at === 0 ? 3 : h[at - 1] === " " ? 2 : 1;
  }
  return total;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, navigate, openCreate, goTo } = useWorkspace();
  const { data: teams } = useTeams();
  const teamOf = useTeamLookup();
  const [query, setQuery] = useState("");
  // Initiatives come from the api's search (the ten most recently updated
  // matches); with nothing typed, the five most recently updated.
  const search = useDebounced(query.trim(), 200);
  const { data: found } = useInitiativePage({ search, limit: search ? 10 : 5 }, { enabled: open });
  const initiatives = found?.items;
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const actions: Command[] = [
      {
        id: "new",
        group: "Actions",
        label: "New initiative",
        icon: <Plus className="h-4 w-4" />,
        keywords: "create add register",
        run: done(() => openCreate()),
      },
      {
        id: "ask",
        group: "Actions",
        label: "Ask Scry a question",
        icon: <MessagesSquare className="h-4 w-4" />,
        keywords: "chat duplicate overlap check idea who",
        run: done(() => navigate({ view: "chat", chat: null })),
      },
    ];
    const views: Command[] = VIEWS.filter((v) => v.id !== "admin" || user.role === "admin").map(
      (v) => ({
        id: `view-${v.id}`,
        group: "Go to",
        label: v.label,
        hint: v.description,
        icon: <v.icon className="h-4 w-4" />,
        run: done(() => goTo(v.id)),
      }),
    );
    const items: Command[] = (initiatives ?? []).map((i) => ({
      id: `i-${i.id}`,
      group: "Initiatives",
      label: i.title,
      hint: teamOf(i.teamId)?.name,
      icon: <span className={cn("h-2 w-2 rounded-full", STATUS_META[i.status].dot)} />,
      keywords: `${i.summary} ${i.tags.join(" ")}`,
      run: done(() => navigate({ i: i.id })),
    }));
    const teamCmds: Command[] = (teams ?? []).map((t) => ({
      id: `t-${t.id}`,
      group: "Teams",
      label: t.name,
      hint: "Show this team's initiatives",
      icon: <Avatar id={t.id} name={t.name} size="xs" square />,
      keywords: `${t.orgUnit ?? ""} ${t.country ?? ""}`,
      run: done(() => navigate({ view: "table", team: t.id })),
    }));
    return [...actions, ...items, ...teamCmds, ...views];
  }, [initiatives, teams, teamOf, user.role, onClose, navigate, openCreate, goTo]);

  const results = useMemo(() => {
    const q = query.trim();
    const list = !q
      ? // Empty query: actions, views, then the most recently updated work.
        [
          ...commands.filter((c) => c.group === "Actions" || c.group === "Go to"),
          ...commands.filter((c) => c.group === "Initiatives").slice(0, 5),
        ]
      : commands
          .map((c) => ({ c, s: score(`${c.label} ${c.keywords ?? ""}`, query) }))
          .filter((r) => r.s >= 0)
          // Title matches outrank keyword-only matches.
          .sort((a, b) => score(b.c.label, query) - score(a.c.label, query) || b.s - a.s)
          .slice(0, 30)
          .map((r) => r.c);
    // Anything typed can also go to Ask Scry as a question — last, so Enter
    // still opens the best match when there is one.
    if (q.length >= 3) {
      list.push({
        id: "ask-question",
        group: "Ask Scry",
        label: `Ask Scry: “${q}”`,
        icon: <MessagesSquare className="h-4 w-4" />,
        run: () => {
          onClose();
          navigate({ view: "chat", chat: null });
          queueQuestion(q);
        },
      });
    }
    // Keyboard order must match the grouped order on screen.
    return list
      .map((c, i) => ({ c, i }))
      .sort((a, b) => GROUPS.indexOf(a.c.group) - GROUPS.indexOf(b.c.group) || a.i - b.i)
      .map((x) => x.c);
  }, [commands, query, onClose, navigate]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-xs animate-fade-in"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-pop animate-fade-in"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            results[active]?.run();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to an initiative, team or view…"
            className="h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-hidden"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-subtle">Nothing matches “{query}”.</p>
          )}
          {GROUPS.map((group) => {
            const items = results.filter((r) => r.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
                  {group === "Teams" ? (
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> Teams
                    </span>
                  ) : (
                    group
                  )}
                </p>
                {items.map((cmd) => {
                  const i = results.indexOf(cmd);
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={cmd.run}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                        i === active ? "bg-elevated text-foreground" : "text-muted",
                      )}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-subtle">
                        {cmd.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="hidden max-w-[40%] shrink-0 truncate text-xs text-subtle sm:block">
                          {cmd.hint}
                        </span>
                      )}
                      {i === active && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-subtle" />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-subtle">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
