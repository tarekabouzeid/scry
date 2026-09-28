"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, UserMinus, Users } from "lucide-react";
import type { TeamMember } from "@scry/shared";
import { api } from "@/lib/api";
import { queryKeys, useTeams } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { EmptyState, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { useWorkspace } from "./workspace";
import { AuditRow } from "./audit-log";

/** Pending join requests for a team, for the sidebar badge. */
export function useTeamRequests(teamId: string | null | undefined) {
  return useQuery({
    queryKey: ["join-requests", teamId],
    queryFn: () => api.teamRequests(teamId!),
    enabled: !!teamId,
    refetchInterval: 60_000,
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Running a team: who asked to join, who's in it (and who else runs it),
 * and the team's own audit trail. For its team admins, and for admins.
 */
export function TeamView() {
  const { user, url } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: teams } = useTeams();
  // Team admins run their own team; admins can open any from Admin → Teams.
  const teamId = user.role === "admin" ? url.team || user.teamId : user.teamId;
  const team = teams?.find((t) => t.id === teamId);

  const requests = useTeamRequests(teamId);
  const members = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => api.teamMembers(teamId!),
    enabled: !!teamId,
  });
  const audit = useQuery({
    queryKey: ["team-audit", teamId],
    queryFn: () => api.teamAudit(teamId!),
    enabled: !!teamId,
  });
  const refresh = () =>
    Promise.all(
      [["join-requests"], ["team-members", teamId], ["team-audit", teamId], queryKeys.users].map(
        (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ),
    );
  const onError = (err: Error) => toast({ tone: "error", message: err.message });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.decideJoinRequest(teamId!, id, approve ? "approve" : "decline"),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (m: TeamMember) => api.removeMember(teamId!, m.id),
    onSuccess: async (_d, m) => {
      await refresh();
      toast({ tone: "success", message: `${m.name} is no longer in ${team?.name}` });
    },
    onError,
  });
  const setAdmin = useMutation({
    mutationFn: (m: TeamMember) => api.setTeamAdmin(teamId!, m.id, !m.teamAdmin),
    onSuccess: refresh,
    onError,
  });

  if (!teamId) {
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" />}
        title="No team to show"
        description="Open a team from Admin → Teams."
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        {team && <Avatar id={team.id} name={team.name} square />}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {team?.name ?? "Team"}
          </h1>
          <p className="text-sm text-muted">
            {[team?.orgUnit, team?.country].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>

      <Section title={`Asking to join${requests.data?.length ? ` · ${requests.data.length}` : ""}`}>
        {requests.isLoading && <Skeleton className="h-12" />}
        {requests.data?.length === 0 && (
          <p className="text-sm text-muted">Nobody is waiting to join.</p>
        )}
        <ul className="space-y-2">
          {requests.data?.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5"
            >
              <Avatar id={r.user.id} name={r.user.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{r.user.name}</p>
                <p className="text-xs text-subtle">
                  {r.user.email} · asked {relativeTime(r.createdAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: true })}
              >
                <Check className="h-3.5 w-3.5" />
                Let in
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: false })}
              >
                Decline
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Members${members.data ? ` · ${members.data.length}` : ""}`}>
        {members.isLoading && <Skeleton className="h-24" />}
        <ul className="divide-y divide-border/70 rounded-xl border border-border bg-surface shadow-card">
          {members.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Avatar id={m.id} name={m.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm text-foreground">
                  {m.name}
                  {m.id === user.id && <span className="text-subtle">(you)</span>}
                  {m.teamAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-accent/10 px-1.5 py-px text-[11px] font-medium text-accent">
                      <ShieldCheck className="h-3 w-3" />
                      Team admin
                    </span>
                  )}
                </p>
                <p className="text-xs text-subtle">{m.email}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={setAdmin.isPending}
                onClick={() => setAdmin.mutate(m)}
              >
                {m.teamAdmin ? "Remove team admin" : "Make team admin"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate(m)}
                aria-label={`Remove ${m.name} from the team`}
                title="Remove from the team"
              >
                <UserMinus className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Team audit log">
        <p className="-mt-1 text-xs text-muted">
          Who asked to join, who was let in or removed, and who got team admin rights.
        </p>
        {audit.isLoading && <Skeleton className="h-24" />}
        {audit.data?.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
        {!!audit.data?.length && (
          <ul className="divide-y divide-border/70 rounded-xl border border-border bg-surface shadow-card">
            {audit.data.map((e) => (
              <AuditRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
