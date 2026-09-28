"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, Plus, Search } from "lucide-react";
import type { AuthenticatedUser } from "@scry/shared";
import type { ViewMode } from "@/lib/url-state";
import { api } from "@/lib/api";
import { Sidebar, VIEWS } from "./sidebar";
import { InitiativeTable } from "./initiative-table";
import { InitiativeKanban } from "./initiative-kanban";
import { TimelineView } from "./timeline-view";
import { GraphView } from "./graph-view";
import { BriefView } from "./brief-view";
import { ChatView } from "./chat-view";
import { SettingsView } from "./settings-view";
import { AdminView } from "./admin-view";
import { InitiativeDetailPanel } from "./initiative-detail-panel";
import { OnboardingPrompt } from "./onboarding-prompt";
import { FullScreenLoader } from "./auth-gate";
import { CommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";
import { WorkspaceProvider, useWorkspace } from "./workspace";
import { Button } from "./ui/button";
import { Kbd } from "./ui/feedback";
import { AiSetupNotice } from "./ai-setup-notice";
import { PendingBanner } from "./pending-banner";
import { TeamView } from "./team-view";
import { useLlmStatus } from "@/lib/queries";
import { onQuestion } from "@/lib/ask";
import { ProductTour } from "./product-tour";
import { HelpMenu, ShortcutsDialog, tourSteps } from "./help-menu";

/** Single-key shortcuts must not fire while someone is typing. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT")
  );
}

function ViewHeader({
  view,
  onMenu,
  onSearch,
  onTour,
  onShortcuts,
}: {
  /** The view actually shown (a member asking for ?view=admin gets the table). */
  view: ViewMode;
  onMenu: () => void;
  onSearch: () => void;
  onTour: () => void;
  onShortcuts: () => void;
}) {
  const { openCreate } = useWorkspace();
  const meta = VIEWS.find((v) => v.id === view)!;
  const Icon = meta.icon;
  return (
    <header className="relative z-20 flex h-14 print:hidden shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm sm:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        data-tour="menu"
        className="focus-ring -ml-1 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-foreground lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="hidden h-7 w-7 items-center justify-center rounded-lg border border-border bg-elevated text-accent sm:flex">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="mr-1 min-w-0 flex-1">
        <h1 className="text-sm font-semibold leading-tight text-foreground">{meta.label}</h1>
        <p className="hidden truncate text-xs text-subtle sm:block">{meta.description}</p>
      </div>

      <button
        type="button"
        onClick={onSearch}
        data-tour="jump-to"
        title="Jump to an initiative, team or view"
        className="focus-ring hidden h-8 w-56 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-subtle transition-colors hover:border-border-strong hover:text-muted md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        onClick={onSearch}
        data-tour="jump-to"
        aria-label="Jump to…"
        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:border-border-strong hover:text-foreground md:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
      <HelpMenu onTour={onTour} onShortcuts={onShortcuts} />
      <div data-tour="inbox" className="flex">
        <NotificationsBell />
      </div>
      {/* From lg up the sidebar carries it; below that the sidebar is a drawer. */}
      <Button
        variant="primary"
        size="sm"
        onClick={() => openCreate()}
        data-tour="new-initiative"
        className="h-8 lg:hidden"
        aria-label="New initiative"
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">New initiative</span>
      </Button>
    </header>
  );
}

function Workspace() {
  const { url, navigate, select, user, openCreate } = useWorkspace();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const queryClient = useQueryClient();

  // The tour starts on the Initiatives page, with nothing else open.
  const startTour = useCallback(() => {
    setNavOpen(false);
    navigate({ view: "table", i: null });
    setTourOpen(true);
  }, [navigate]);
  const endTour = useCallback(() => {
    setTourOpen(false);
    if (!user.tourSeenAt)
      void api
        .markTourSeen()
        .then(() => queryClient.invalidateQueries({ queryKey: ["me"] }))
        .catch(() => undefined);
  }, [user.tourSeenAt, queryClient]);
  // First visit: show the tour once the workspace has had a moment to render.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (user.tourSeenAt || autoStarted.current) return;
    autoStarted.current = true;
    const t = setTimeout(startTour, 700);
    return () => clearTimeout(t);
  }, [user.tourSeenAt, startTour]);
  // Remount the chat only on explicit navigation — not when a brand-new chat
  // gets its session id mid-send, which would drop the in-flight message.
  const [chatInstance, setChatInstance] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (
        e.key === "?" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !isTyping(e.target) &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (
        e.key.toLowerCase() === "c" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !paletteOpen &&
        !isTyping(e.target) &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        openCreate();
      } else if (e.key === "Escape" && url.i && !paletteOpen) {
        // Dialogs stop propagation of their own Escape, so this only fires
        // when nothing is layered above the panel.
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url.i, paletteOpen, select, openCreate]);

  // A question for Ask Scry from elsewhere always gets a fresh conversation.
  useEffect(() => onQuestion(() => setChatInstance((n) => n + 1)), []);

  // Close the mobile drawer whenever the view changes.
  useEffect(() => setNavOpen(false), [url.view, url.chat]);

  const view =
    (url.view === "admin" && user.role !== "admin") ||
    (url.view === "team" && user.role !== "admin" && !user.teamAdmin)
      ? "table"
      : url.view;
  // Admins get a nudge everywhere until a model is connected (except where
  // they'd fix it, and in chat, which shows its own notice).
  const { data: llmStatus } = useLlmStatus();
  const showAiBar =
    llmStatus?.configured === false &&
    user.role === "admin" &&
    view !== "chat" &&
    !(view === "admin" && url.tab === "ai");

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <Sidebar
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSelectSession={(sessionId) => {
          setChatInstance((n) => n + 1);
          navigate({ view: "chat", chat: sessionId });
        }}
        // Sessions are created lazily on the first message, so an abandoned
        // "new chat" click doesn't leave an empty session in the history.
        onNewChat={() => {
          setChatInstance((n) => n + 1);
          navigate({ view: "chat", chat: null });
        }}
      />

      <main className="relative flex min-w-0 flex-1 flex-col print:block">
        <div className="pointer-events-none absolute print:hidden inset-x-0 top-0 h-64 bg-linear-to-b from-accent/4 to-transparent" />
        <ViewHeader
          view={view}
          onMenu={() => setNavOpen(true)}
          onSearch={() => setPaletteOpen(true)}
          onTour={startTour}
          onShortcuts={() => setShortcutsOpen(true)}
        />
        <PendingBanner />
        {showAiBar && (
          <AiSetupNotice
            variant="bar"
            feature="Ask Scry, semantic search and overlap detection"
            className="relative print:hidden"
          />
        )}
        <div
          key={view}
          className="relative min-h-0 flex-1 overflow-y-auto animate-fade-in print:overflow-visible print:animate-none"
        >
          {view === "table" && <InitiativeTable />}
          {view === "kanban" && <InitiativeKanban />}
          {view === "timeline" && <TimelineView />}
          {view === "graph" && <GraphView onSelect={select} selectedId={url.i} />}
          {view === "brief" && <BriefView />}
          {view === "chat" && (
            <ChatView
              key={chatInstance}
              sessionId={url.chat}
              // Replace, not push: the new id belongs to the same history entry.
              onSessionCreated={(id) => navigate({ chat: id }, { replace: true })}
              onSelectInitiative={(i) => select(i.id)}
              userName={user.name}
              userId={user.id}
            />
          )}
          {view === "settings" && <SettingsView />}
          {view === "team" && <TeamView />}
          {view === "admin" && <AdminView />}
        </div>
      </main>

      {url.i && (
        <InitiativeDetailPanel
          key={url.i}
          initiativeId={url.i}
          onSelect={(id) => select(id)}
          onClose={() => select(null)}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ProductTour steps={tourSteps(user)} open={tourOpen} onClose={endTour} />
    </div>
  );
}

export function AppView({ user }: { user: AuthenticatedUser }) {
  const { data: onboarding, isLoading } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: api.onboardingStatus,
  });

  if (isLoading) return <FullScreenLoader label="Loading workspace" />;

  // Admins see everything without a team. Anyone else picks a team first;
  // while they wait for approval they can look around (with a banner).
  if (onboarding && !onboarding.hasTeam && !onboarding.pending && user.role !== "admin") {
    return <OnboardingPrompt />;
  }

  return (
    <WorkspaceProvider user={user}>
      <Workspace />
    </WorkspaceProvider>
  );
}
