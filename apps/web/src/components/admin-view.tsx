"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FileUp,
  GitMerge,
  Pencil,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { Team, UserRole } from "@scry/shared";
import { api } from "@/lib/api";
import {
  queryKeys,
  useInitiativeCounts,
  useInvalidateInitiatives,
  useLlmStatus,
  useTeams,
  useUsers,
} from "@/lib/queries";
import { Avatar } from "./ui/avatar";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Tabs } from "./ui/tabs";
import { Field } from "./ui/form";
import { ErrorNote, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { ImportDialog } from "./import-dialog";
import { useWorkspace } from "./workspace";
import { AiSettings } from "./ai-settings";
import { McpAdmin } from "./mcp-admin";
import { AuditLog } from "./audit-log";
import { cn } from "@/lib/cn";
import { usePref } from "@/lib/prefs";

const ADMIN_TABS = ["people", "teams", "ai", "mcp", "audit"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

function People() {
  const { user: me } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: users, isLoading } = useUsers();
  const { data: teams } = useTeams();
  const [query, setQuery] = useState("");

  const update = useMutation({
    mutationFn: ({
      id,
      dto,
    }: {
      id: string;
      dto: { teamId?: string | null; role?: UserRole; teamAdmin?: boolean };
    }) => api.updateUser(id, dto),
    onSuccess: async (u) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users });
      toast({ tone: "success", message: `Updated ${u.name}` });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <div className="space-y-3">
      <Input
        icon={<Search className="h-4 w-4" />}
        placeholder="Search people…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="sm:w-72"
      />
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-elevated/50 text-left text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">Person</th>
              <th className="px-4 py-2.5 font-medium">Team</th>
              <th className="px-4 py-2.5 font-medium">Team admin</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {isLoading && (
              <tr>
                <td colSpan={4} className="p-4">
                  <Skeleton className="h-10" />
                </td>
              </tr>
            )}
            {shown.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar id={u.id} name={u.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-foreground">
                        {u.name}
                        {u.id === me.id && <span className="text-subtle"> (you)</span>}
                      </p>
                      <p className="truncate text-xs text-subtle">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <Select
                    aria-label={`${u.name}'s team`}
                    value={u.teamId ?? ""}
                    onChange={(e) =>
                      update.mutate({ id: u.id, dto: { teamId: e.target.value || null } })
                    }
                    className="w-48"
                  >
                    <option value="">No team</option>
                    {teams
                      ?.filter((t) => t.status === "active")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`${u.name} is a team admin`}
                    checked={u.teamAdmin}
                    disabled={!u.teamId}
                    title={u.teamId ? undefined : "Only someone in a team can be its team admin"}
                    onChange={(e) =>
                      update.mutate({ id: u.id, dto: { teamAdmin: e.target.checked } })
                    }
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                </td>
                <td className="px-4 py-2.5">
                  <Select
                    value={u.role}
                    // Don't let an admin lock themselves out by accident.
                    disabled={u.id === me.id}
                    onChange={(e) =>
                      update.mutate({ id: u.id, dto: { role: e.target.value as UserRole } })
                    }
                    icon={u.role === "admin" ? <ShieldCheck className="h-3.5 w-3.5" /> : undefined}
                    className="w-36"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamRow({
  team,
  members,
  initiatives,
  onMerge,
}: {
  team: Team;
  members: number;
  initiatives: number;
  onMerge: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: team.name,
    orgUnit: team.orgUnit ?? "",
    country: team.country ?? "",
  });
  const { data: options } = useTeamOptions();
  const { navigate } = useWorkspace();
  const save = useMutation({
    mutationFn: () =>
      api.updateTeam(team.id, {
        name: draft.name.trim(),
        orgUnit: draft.orgUnit || undefined,
        country: draft.country || undefined,
      }),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <Avatar id={team.id} name={team.name} square />
      {editing ? (
        <form
          className="grid flex-1 gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim()) save.mutate();
          }}
        >
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name"
          />
          <OptionSelect
            label="Org unit"
            value={draft.orgUnit}
            options={options?.orgUnits}
            onChange={(orgUnit) => setDraft({ ...draft, orgUnit })}
          />
          <div className="flex gap-2">
            <OptionSelect
              label="Country"
              value={draft.country}
              options={options?.countries}
              onChange={(country) => setDraft({ ...draft, country })}
              className="flex-1"
            />
            <Button
              type="submit"
              size="icon"
              variant="primary"
              aria-label="Save"
              disabled={save.isPending}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Cancel"
              onClick={() => setEditing(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{team.name}</p>
            <p className="text-xs text-subtle">
              {[team.orgUnit, team.country].filter(Boolean).join(" · ") || "No org unit"} ·{" "}
              {members} member{members === 1 ? "" : "s"} · {initiatives} initiative
              {initiatives === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate({ view: "team", team: team.id, i: null })}
            >
              <Users className="h-3.5 w-3.5" />
              Open
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onMerge}>
              <GitMerge className="h-3.5 w-3.5" />
              Merge…
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function TeamsAdmin() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();
  const { data: teams, isLoading } = useTeams();
  const { data: users } = useUsers();
  const { counts: perTeam } = useInitiativeCounts("team");
  const [merging, setMerging] = useState<Team | null>(null);
  const [target, setTarget] = useState("");

  const counts = useMemo(() => {
    const m = new Map<string, { members: number; initiatives: number }>();
    for (const t of teams ?? []) m.set(t.id, { members: 0, initiatives: perTeam.of(t.id) });
    for (const u of users ?? []) {
      const entry = u.teamId ? m.get(u.teamId) : undefined;
      if (entry) entry.members++;
    }
    return m;
  }, [teams, users, perTeam]);

  const merge = useMutation({
    mutationFn: () => api.mergeTeam(merging!.id, target),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users }),
        invalidate(),
      ]);
      toast({
        tone: "success",
        message: `Merged into ${res.team.name}: ${res.movedUsers} people, ${res.movedInitiatives} initiatives moved`,
      });
      setMerging(null);
      setTarget("");
    },
  });

  const active = teams?.filter((t) => t.status === "active");
  return (
    <>
      <PendingTeams />
      <JoinRequests />
      <NewTeam />
      {isLoading && <Skeleton className="h-24" />}
      <ul className="divide-y divide-border/70 rounded-xl border border-border bg-surface shadow-card">
        {active?.map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            members={counts.get(t.id)?.members ?? 0}
            initiatives={counts.get(t.id)?.initiatives ?? 0}
            onMerge={() => {
              merge.reset();
              setMerging(t);
            }}
          />
        ))}
      </ul>

      <Dialog
        open={!!merging}
        onClose={() => setMerging(null)}
        title={`Merge “${merging?.name}” into another team`}
        description="Its members, initiatives and followers move to the team you pick, then it's deleted. This can't be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMerging(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!target || merge.isPending}
              onClick={() => merge.mutate()}
            >
              {merge.isPending ? "Merging…" : "Merge teams"}
            </Button>
          </>
        }
      >
        <Field label="Merge into">
          <Select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            icon={<Users className="h-3.5 w-3.5" />}
          >
            <option value="">Choose a team…</option>
            {active
              ?.filter((t) => t.id !== merging?.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
        </Field>
        {merge.error && <ErrorNote className="mt-3">{merge.error.message}</ErrorNote>}
      </Dialog>
    </>
  );
}

/** The org units and countries configured for this organisation. */
function useTeamOptions() {
  return useQuery({ queryKey: ["team-options"], queryFn: api.teamOptions, staleTime: 300_000 });
}

function OptionSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: string[] | undefined;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <option value="">{label}…</option>
      {/* Keep a value set before the list changed, so saving doesn't drop it. */}
      {value && !options?.includes(value) && <option value={value}>{value}</option>}
      {options?.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}

/** Teams people created during onboarding, waiting for an admin. */
function PendingTeams() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: teams } = useQuery({
    queryKey: [...queryKeys.teams, "with-pending"],
    queryFn: api.listAllTeams,
  });
  const { data: users } = useUsers();
  const pending = teams?.filter((t) => t.status === "pending") ?? [];
  const decide = useMutation({
    mutationFn: async ({ team, approve }: { team: Team; approve: boolean }) => {
      if (approve) await api.approveTeam(team.id);
      else await api.declineTeam(team.id);
    },
    onSuccess: async (_d, { team, approve }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users }),
      ]);
      toast({
        tone: "success",
        message: approve ? `${team.name} is now a team` : `Declined ${team.name}`,
      });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  if (pending.length === 0) return null;
  return (
    <section className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
      <h3 className="text-sm font-medium text-foreground">New teams waiting for approval</h3>
      <p className="mt-0.5 text-xs text-muted">
        Approving makes the team real, with the person who asked for it as its team admin.
      </p>
      <ul className="mt-3 space-y-2">
        {pending.map((t) => {
          const creator = users?.find((u) => u.id === t.createdBy);
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
              <Avatar id={t.id} name={t.name} square />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-subtle">
                  {[t.orgUnit, t.country].filter(Boolean).join(" · ")} · asked for by{" "}
                  {creator?.name ?? "someone"}
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ team: t, approve: true })}
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ team: t, approve: false })}
              >
                Decline
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Everyone waiting to join a team. Team admins decide too; admins can step in. */
function JoinRequests() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: teams } = useTeams();
  const { data: requests } = useQuery({
    queryKey: ["join-requests", "all"],
    queryFn: api.allJoinRequests,
  });
  const decide = useMutation({
    mutationFn: ({ teamId, id, approve }: { teamId: string; id: string; approve: boolean }) =>
      api.decideJoinRequest(teamId, id, approve ? "approve" : "decline"),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["join-requests"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.users }),
      ]);
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  if (!requests?.length) return null;
  return (
    <section className="mb-4 rounded-xl border border-border bg-surface p-4 shadow-card">
      <h3 className="text-sm font-medium text-foreground">Requests to join a team</h3>
      <p className="mt-0.5 text-xs text-muted">
        Each team&apos;s admins see their own; you can decide any of them.
      </p>
      <ul className="mt-3 space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 text-sm">
            <Avatar id={r.user.id} name={r.user.name} size="sm" />
            <p className="min-w-0 flex-1 text-foreground">
              {r.user.name}{" "}
              <span className="text-subtle">
                wants to join {teams?.find((t) => t.id === r.teamId)?.name ?? "a team"}
              </span>
            </p>
            <Button
              size="sm"
              variant="primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ teamId: r.teamId, id: r.id, approve: true })}
            >
              Let in
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ teamId: r.teamId, id: r.id, approve: false })}
            >
              Decline
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Admins create teams directly; the org unit and country come from the configured lists. */
function NewTeam() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: options } = useTeamOptions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", orgUnit: "", country: "" });
  const create = useMutation({
    mutationFn: () => api.createTeam({ ...draft, name: draft.name.trim() }),
    onSuccess: async (team) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      toast({ tone: "success", message: `Created ${team.name}` });
      setDraft({ name: "", orgUnit: "", country: "" });
      setOpen(false);
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  if (!open) {
    return (
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New team
        </Button>
      </div>
    );
  }
  return (
    <form
      className="mb-4 grid gap-2 rounded-xl border border-border bg-surface p-4 shadow-card sm:grid-cols-[2fr_1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.name.trim() && draft.orgUnit && draft.country) create.mutate();
      }}
    >
      <Input
        autoFocus
        aria-label="Team name"
        placeholder="Team name"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <OptionSelect
        label="Org unit"
        value={draft.orgUnit}
        options={options?.orgUnits}
        onChange={(orgUnit) => setDraft({ ...draft, orgUnit })}
      />
      <OptionSelect
        label="Country"
        value={draft.country}
        options={options?.countries}
        onChange={(country) => setDraft({ ...draft, country })}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={!draft.name.trim() || !draft.orgUnit || !draft.country || create.isPending}
        >
          Create
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  action?: { label: string; run: () => void };
}

/**
 * First-run checklist for admins: what a fresh install still needs before
 * Scry is useful. Disappears once everything is done, or when dismissed.
 */
function SetupChecklist({ onImport }: { onImport: () => void }) {
  const { navigate } = useWorkspace();
  const { data: llm } = useLlmStatus();
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const { counts: registered, data: countRows } = useInitiativeCounts("status");
  const [dismissed, setDismissed] = usePref("scry-admin-checklist-dismissed", false);
  if (!llm || !users || !teams || !countRows) return null;

  const withoutTeam = users.filter((u) => !u.teamId).length;
  const admins = users.filter((u) => u.role === "admin").length;
  const steps: Step[] = [
    {
      id: "ai",
      title: "Connect an AI model",
      hint: "Powers Ask Scry, semantic search and duplicate detection.",
      done: llm.configured,
      action: { label: "Set up AI", run: () => navigate({ tab: "ai" }, { replace: true }) },
    },
    {
      id: "initiatives",
      title: "Add your roadmap",
      hint: "Import a CSV, or ask each team to register what they're working on.",
      done: registered.total > 0,
      action: { label: "Import CSV", run: onImport },
    },
    {
      id: "people",
      title: "Get people signed in",
      hint: "Share the link — anyone in your identity provider can sign in and pick a team.",
      done: users.length > 1,
    },
    {
      id: "teams",
      title: "Put everyone in a team",
      hint:
        withoutTeam > 0
          ? `${withoutTeam} ${withoutTeam === 1 ? "person has" : "people have"} no team yet.`
          : "Everyone belongs to a team.",
      done: teams.length > 0 && withoutTeam === 0,
      action: { label: "Review people", run: () => navigate({ tab: "" }, { replace: true }) },
    },
    {
      id: "admin",
      title: "Add a second admin",
      hint: "So you're never locked out of settings if one account goes away.",
      done: admins > 1,
      action: { label: "Review people", run: () => navigate({ tab: "" }, { replace: true }) },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  return (
    <section
      aria-label="Setup checklist"
      className="rounded-xl border border-accent/30 bg-accent/4 p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-gradient text-white">
          <Rocket className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Finish setting up Scry</p>
          <p className="text-xs text-muted">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Hide
        </Button>
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
      >
        <div
          className="h-full rounded-full bg-accent-gradient transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <ol className="mt-3 divide-y divide-border/60">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-3 py-2.5">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                step.done
                  ? "border-status-shipped bg-status-shipped text-white"
                  : "border-border-strong",
              )}
              aria-hidden
            >
              {step.done && <Check className="h-3 w-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm",
                  step.done ? "text-muted line-through decoration-subtle" : "text-foreground",
                )}
              >
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
              </p>
              {!step.done && <p className="text-xs text-muted">{step.hint}</p>}
            </div>
            {!step.done && step.action && (
              <Button size="sm" onClick={step.action.run}>
                {step.action.label}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AdminView() {
  const { url, navigate } = useWorkspace();
  const tab: AdminTab = (ADMIN_TABS as readonly string[]).includes(url.tab)
    ? (url.tab as AdminTab)
    : "people";
  const setTab = (next: AdminTab) =>
    navigate({ tab: next === "people" ? "" : next }, { replace: true });
  const [importing, setImporting] = useState(false);
  const { data: users } = useUsers();
  const { data: teams } = useTeams();

  return (
    <div className="flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
      {tab !== "audit" && <SetupChecklist onImport={() => setImporting(true)} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "people", label: "People", count: users?.length },
            {
              id: "teams",
              label: "Teams",
              count: teams?.filter((t) => t.status === "active").length,
            },
            { id: "ai", label: "AI & models" },
            { id: "mcp", label: "AI tools" },
            { id: "audit", label: "Audit log" },
          ]}
          className="flex-1"
        />
        {(tab === "people" || tab === "teams") && (
          <Button onClick={() => setImporting(true)}>
            <FileUp className="h-3.5 w-3.5" />
            Import initiatives
          </Button>
        )}
      </div>
      {tab === "people" && <People />}
      {tab === "teams" && <TeamsAdmin />}
      {tab === "ai" && <AiSettings />}
      {tab === "mcp" && <McpAdmin />}
      {tab === "audit" && <AuditLog />}
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
