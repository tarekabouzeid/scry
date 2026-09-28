"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  CheckCheck,
  CircleDot,
  GitMerge,
  HandHeart,
  MessageSquare,
  Settings,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Popover } from "./ui/popover";
import { Skeleton } from "./ui/feedback";
import { useWorkspace } from "./workspace";

const KIND_ICON: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  overlap_detected: { icon: AlertTriangle, tone: "text-warning bg-warning/10" },
  dependency_added: { icon: ArrowRightLeft, tone: "text-status-planned bg-status-planned/10" },
  status_changed: { icon: CircleDot, tone: "text-status-progress bg-status-progress/10" },
  commented: { icon: MessageSquare, tone: "text-accent bg-accent/10" },
  merged: { icon: GitMerge, tone: "text-status-shipped bg-status-shipped/10" },
  signal_added: { icon: HandHeart, tone: "text-accent-2 bg-accent-2/10" },
  team_request: { icon: UserPlus, tone: "text-accent bg-accent/10" },
  team_update: { icon: UsersRound, tone: "text-status-shipped bg-status-shipped/10" },
  merge_request: { icon: GitMerge, tone: "text-accent bg-accent/10" },
  merge_update: { icon: GitMerge, tone: "text-muted bg-elevated" },
};

export function NotificationsBell() {
  const { navigate, user } = useWorkspace();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: api.notifications,
    // Cheap poll — the inbox is small and there's no push channel yet.
    refetchInterval: 60_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  const readAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh });
  const readOne = useMutation({ mutationFn: api.markNotificationRead, onSuccess: refresh });
  const unread = data?.unreadCount ?? 0;

  return (
    <Popover
      className="w-[min(24rem,calc(100vw-2rem))]"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
          className={cn(
            "focus-ring relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-elevated",
            open
              ? "border-border-strong bg-elevated text-foreground"
              : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-gradient px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => readAll.mutate()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-elevated hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                title="Notification settings"
                aria-label="Notification settings"
                onClick={() => {
                  close();
                  navigate({ view: "settings" });
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {isLoading && <Skeleton className="m-2 h-16" />}
            {data?.items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-foreground">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-subtle">
                  You&apos;ll hear about overlaps, new dependencies and comments on your work — and
                  anything you follow.
                </p>
              </div>
            )}
            {data?.items.map((n) => {
              const meta = KIND_ICON[n.kind];
              const Icon = meta.icon;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.readAt) readOne.mutate(n.id);
                    if (n.initiativeId) {
                      close();
                      navigate({ i: n.initiativeId });
                    } else if (n.kind === "team_request") {
                      // Admins decide every request (and new teams) from Admin → Teams.
                      close();
                      navigate(
                        user.role === "admin"
                          ? { view: "admin", tab: "teams", i: null }
                          : { view: "team", i: null },
                      );
                    } else if (n.kind === "team_update") {
                      // Let in, removed, or a new team approved: who they are changed.
                      void queryClient.invalidateQueries({ queryKey: ["me"] });
                      void queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
                    }
                  }}
                  className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-elevated"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      meta.tone,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm leading-snug",
                        n.readAt ? "text-muted" : "text-foreground",
                      )}
                    >
                      {n.text}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-subtle">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}
