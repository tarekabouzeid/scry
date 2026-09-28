"use client";

import { BookOpen, CircleHelp, Compass, Keyboard } from "lucide-react";
import type { AuthenticatedUser } from "@scry/shared";
import { Dialog } from "./ui/dialog";
import { Kbd } from "./ui/feedback";
import { MenuItem, Popover } from "./ui/popover";
import type { TourStep } from "./product-tour";

/** Served by the web app from docs/ (copied at build time; see scripts/copy-guide.mjs). */
export const USER_GUIDE_URL = "/guide/index.html";

export function tourSteps(user: AuthenticatedUser): TourStep[] {
  return [
    {
      title: "Welcome to Scry",
      body: (
        <>
          Scry is where every team shares what it&apos;s building or thinking about, so you find
          related work before you start. This tour takes about a minute.
        </>
      ),
    },
    {
      target: "new-initiative",
      title: "Share your work",
      body: (
        <>
          Add an idea or a project here, or press <Kbd>C</Kbd>. AI can fill in the form from a rough
          description, and Scry warns you if another team has something similar.
        </>
      ),
    },
    {
      target: ["views", "menu"],
      title: "See everyone's work",
      body: "The same initiatives as a list, a board by status or team, a timeline, or a graph of how they connect.",
    },
    {
      target: "first-initiative",
      title: "Open any initiative",
      body: (
        <>
          Click one to see its one-line summary, who to talk to and what it depends on. If your team
          needs it too, say so there.
        </>
      ),
    },
    {
      target: ["ask-scry", "menu"],
      title: "Ask before you build",
      body: "Not sure if something already exists? Ask in plain words. Scry tells you which team works on it and who to contact.",
    },
    {
      target: "jump-to",
      title: "Find anything",
      body: (
        <>
          Jump to any initiative, team or page, or type a question for Ask Scry. Shortcut:{" "}
          <Kbd>⌘</Kbd> <Kbd>K</Kbd>.
        </>
      ),
    },
    {
      target: "inbox",
      title: "Stay in the loop",
      body: "Your inbox shows overlaps with your work, other teams building on it or needing it, comments and status changes. Follow teams or tags to hear about more.",
    },
    {
      target: ["brief", "menu"],
      title: "The big picture",
      body: "A one-page read on what needs a decision: possible duplicates, work several teams want, and what's emerging. Useful for leadership.",
    },
    ...(user.teamAdmin
      ? [
          {
            target: ["team", "menu"],
            title: "Run your team",
            body: "You're a team admin: let in people who ask to join, manage members, and see your team's audit log here.",
          },
        ]
      : []),
    ...(user.role === "admin"
      ? [
          {
            target: ["admin", "menu"],
            title: "Set things up",
            body: "Connect AI, approve new teams, manage people and teams, and import a roadmap. You're not in a team: you see and run everything.",
          },
        ]
      : []),
    {
      target: "help",
      title: "Help is here",
      body: "Replay this tour, open the user guide or see the keyboard shortcuts from this button at any time.",
    },
  ];
}

export function HelpMenu({ onTour, onShortcuts }: { onTour: () => void; onShortcuts: () => void }) {
  return (
    <Popover
      className="w-56 p-1"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Help"
          aria-expanded={open}
          title="Help"
          data-tour="help"
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Compass className="h-3.5 w-3.5" />} onClick={() => (close(), onTour())}>
            Take the tour
          </MenuItem>
          <MenuItem
            icon={<BookOpen className="h-3.5 w-3.5" />}
            onClick={() => (close(), window.open(USER_GUIDE_URL, "_blank", "noopener"))}
          >
            User guide
          </MenuItem>
          <MenuItem
            icon={<Keyboard className="h-3.5 w-3.5" />}
            onClick={() => (close(), onShortcuts())}
          >
            Keyboard shortcuts
          </MenuItem>
        </>
      )}
    </Popover>
  );
}

const SHORTCUTS: { keys: string[][]; action: string }[] = [
  { keys: [["C"]], action: "New initiative" },
  {
    keys: [
      ["⌘", "K"],
      ["Ctrl", "K"],
    ],
    action: "Jump to anything, or ask Scry",
  },
  { keys: [["Esc"]], action: "Close the details panel or a dialog" },
  { keys: [["?"]], action: "Show these shortcuts" },
  { keys: [["⌘", "↵"]], action: "Draft with AI, in the New initiative form" },
  {
    keys: [
      ["Alt", "←"],
      ["Alt", "→"],
    ],
    action: "Move the focused board card",
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border/70">
          {SHORTCUTS.map((s) => (
            <tr key={s.action}>
              <td className="whitespace-nowrap py-2 pr-4">
                {s.keys.map((combo, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-subtle">or</span>}
                    {combo.map((k) => (
                      <span key={k} className="mr-0.5">
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                ))}
              </td>
              <td className="py-2 text-muted">{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
