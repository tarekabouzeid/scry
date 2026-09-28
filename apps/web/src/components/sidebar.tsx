"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarRange,
  FileText,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Plus,
  Settings,
  ShieldCheck,
  SquareKanban,
  Table2,
  UsersRound,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { queryKeys, useInitiativeCounts, useTeamLookup } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import type { ViewMode } from "@/lib/url-state";
import { Avatar } from "./ui/avatar";
import { Logo } from "./ui/logo";
import { Skeleton } from "./ui/feedback";
import { ThemeToggle } from "./theme-toggle";
import { useWorkspace } from "./workspace";
import { describeView, useSavedViews } from "./saved-views";
import { useTeamRequests } from "./team-view";

export type { ViewMode };

export const VIEWS: { id: ViewMode; label: string; icon: LucideIcon; description: string }[] = [
  {
    id: "table",
    label: "Initiatives",
    icon: Table2,
    description: "Every initiative across every team",
  },
  { id: "kanban", label: "Board", icon: SquareKanban, description: "Initiatives grouped by lane" },
  {
    id: "timeline",
    label: "Timeline",
    icon: CalendarRange,
    description: "Who is shipping what, and when",
  },
  { id: "graph", label: "Graph", icon: Waypoints, description: "How initiatives relate" },
  {
    id: "brief",
    label: "Brief",
    icon: FileText,
    description: "Where the portfolio stands, for leadership",
  },
  {
    id: "chat",
    label: "Ask Scry",
    icon: MessagesSquare,
    description: "Ask whether something already exists, or who's working on it",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    description: "Notifications, API tokens and appearance",
  },
  {
    id: "team",
    label: "Team",
    icon: UsersRound,
    description: "Requests to join, members and the team's audit log",
  },
  {
    id: "admin",
    label: "Admin",
    icon: ShieldCheck,
    description: "Manage people, teams and imports",
  },
];

const WORKSPACE_VIEWS: ViewMode[] = ["table", "kanban", "timeline", "graph", "brief"];

function NavItem({
  active,
  icon: Icon,
  label,
  count,
  title,
  tour,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  count?: number;
  title?: string;
  /** Anchor for the product tour. */
  tour?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-tour={tour}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors",
        active
          ? "bg-elevated text-foreground shadow-card"
          : "text-muted hover:bg-elevated/60 hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-accent-gradient" />
      )}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-accent" : "text-subtle group-hover:text-muted",
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-md bg-background/60 px-1.5 font-mono text-[11px] text-subtle">
          {count}
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  open,
  onClose,
  onSelectSession,
  onNewChat,
}: {
  /** Mobile drawer state; always visible from lg up. */
  open: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
}) {
  const { user, url, goTo, openCreate } = useWorkspace();
  const { data: teamRequests } = useTeamRequests(user.teamAdmin ? user.teamId : null);
  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: api.listChatSessions,
  });
  const { counts: initiativeCounts, data: countRows } = useInitiativeCounts("status");
  const team = useTeamLookup()(user.teamId ?? "");
  const saved = useSavedViews();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-fade-in lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-72 print:hidden shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:translate-x-0 lg:bg-surface/70 lg:backdrop-blur-sm",
          open ? "translate-x-0 shadow-pop" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Logo />
          {team && (
            <span
              title={`Your team: ${team.name}`}
              className="ml-auto flex max-w-28 items-center gap-1.5 truncate rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] text-muted"
            >
              <Avatar id={team.id} name={team.name} size="xs" square />
              <span className="truncate">{team.name}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-elevated lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The core action gets the most prominent spot in the app. */}
        <div className="px-3 pb-1 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              openCreate();
            }}
            aria-keyshortcuts="C"
            data-tour="new-initiative"
            className="focus-ring flex h-9 w-full items-center gap-2 rounded-lg bg-accent-gradient px-3 text-sm font-medium text-white shadow-glow transition-all hover:brightness-110 active:scale-[0.99] [text-shadow:0_1px_0_rgb(0_0_0/0.15)]"
          >
            <Plus className="h-4 w-4" />
            <span className="flex-1 text-left">New initiative</span>
            <kbd className="rounded-sm border border-white/25 bg-white/10 px-1.5 font-mono text-[10px] font-normal text-white/80">
              C
            </kbd>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 pb-3 pt-1">
          <p className="px-2.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
            Workspace
          </p>
          <div data-tour="views" className="flex flex-col gap-0.5">
            {VIEWS.filter((v) => WORKSPACE_VIEWS.includes(v.id) && v.id !== "brief").map((v) => (
              <NavItem
                key={v.id}
                active={url.view === v.id}
                icon={v.icon}
                label={v.label}
                count={v.id === "table" && countRows ? initiativeCounts.total : undefined}
                onClick={() => goTo(v.id)}
              />
            ))}
          </div>
          <NavItem
            active={url.view === "brief"}
            icon={FileText}
            label="Brief"
            tour="brief"
            onClick={() => goTo("brief")}
          />
          {/* A peer of the views, not a second call to action: the create form
              now does the "does this exist?" check itself. */}
          <NavItem
            active={url.view === "chat"}
            icon={MessagesSquare}
            label="Ask Scry"
            tour="ask-scry"
            title="Ask whether something already exists, or who's working on it"
            onClick={onNewChat}
          />
          {saved.views.length > 0 && (
            <>
              <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
                Saved views
              </p>
              <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                {saved.views.map((v) => (
                  <NavItem
                    key={v.id}
                    active={saved.activeId === v.id}
                    icon={Bookmark}
                    label={v.name}
                    title={describeView(v.state)}
                    onClick={() => saved.apply(v)}
                  />
                ))}
              </div>
            </>
          )}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 px-3 pt-3">
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-subtle">
              Recent questions
            </p>
            <button
              type="button"
              onClick={onNewChat}
              title="New question"
              aria-label="New question"
              className="focus-ring flex h-6 w-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-2">
            {sessionsLoading &&
              Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="mb-1.5 h-9" />)}
            {sessions?.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-subtle">
                None yet. Ask whether something already exists or who&apos;s working on it, here or
                with ⌘K.
              </p>
            )}
            {sessions?.map((session) => {
              const active = url.view === "chat" && url.chat === session.id;
              return (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  className={cn(
                    "focus-ring group flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    active ? "bg-elevated text-foreground" : "text-muted hover:bg-elevated/60",
                  )}
                >
                  <MessageSquare
                    className={cn(
                      "mt-0.5 h-3.5 w-3.5 shrink-0",
                      active ? "text-accent" : "text-subtle",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13px]",
                        active ? "text-foreground" : "group-hover:text-foreground",
                      )}
                    >
                      {session.title ?? "New chat"}
                    </span>
                    <span className="block text-[11px] text-subtle">
                      {session.registeredInitiativeId ? "Registered · " : ""}
                      {relativeTime(session.updatedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-0.5 border-t border-border/70 px-3 py-2">
          <NavItem
            active={url.view === "settings"}
            icon={Settings}
            label="Settings"
            onClick={() => goTo("settings")}
          />
          {user.teamAdmin && (
            <NavItem
              active={url.view === "team"}
              icon={UsersRound}
              label="Team"
              count={teamRequests?.length}
              title={
                teamRequests?.length
                  ? `${teamRequests.length} waiting to join your team`
                  : "Your team's members and audit log"
              }
              tour="team"
              onClick={() => goTo("team")}
            />
          )}
          {user.role === "admin" && (
            <NavItem
              active={url.view === "admin"}
              icon={ShieldCheck}
              label="Admin"
              tour="admin"
              onClick={() => goTo("admin")}
            />
          )}
        </div>

        <div className="border-t border-border/70 p-3">
          <div className="flex items-center gap-2 rounded-lg p-1.5">
            <Avatar id={user.id} name={user.name} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                <span className="truncate">{user.name}</span>
                {user.role === "admin" && (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="Admin" />
                )}
              </p>
              <p className="truncate text-xs text-subtle">{user.email}</p>
            </div>
            <ThemeToggle />
            <a
              href={api.logoutUrl()}
              title="Sign out"
              aria-label="Sign out"
              className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
