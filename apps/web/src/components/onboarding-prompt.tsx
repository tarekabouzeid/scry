"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, Globe, LogOut, Plus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useTeams } from "@/lib/queries";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Avatar } from "./ui/avatar";
import { ErrorNote, Skeleton } from "./ui/feedback";
import { LogoMark } from "./ui/logo";
import { SplashShell } from "./auth-gate";

export function OnboardingPrompt() {
  const queryClient = useQueryClient();
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const [mode, setMode] = useState<"join" | "create">("join");
  const [teamId, setTeamId] = useState("");
  const [name, setName] = useState("");
  const [orgUnit, setOrgUnit] = useState("");
  const [country, setCountry] = useState("");

  const onDone = () => {
    queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    queryClient.invalidateQueries({ queryKey: ["me"] });
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  };

  // New teams are filed under the organisation's own org units and countries.
  const { data: options } = useQuery({ queryKey: ["team-options"], queryFn: api.teamOptions });

  const join = useMutation({
    mutationFn: () => api.requestToJoin(teamId),
    onSuccess: onDone,
  });
  const create = useMutation({
    mutationFn: () => api.requestTeam({ name: name.trim(), orgUnit, country }),
    onSuccess: onDone,
  });
  const error = mode === "join" ? join.error : create.error;

  // Nobody to join yet — the first user has to create a team.
  const noTeams = !teamsLoading && (teams?.length ?? 0) === 0;
  const effectiveMode = noTeams ? "create" : mode;

  return (
    <SplashShell>
      <div className="mx-auto w-full max-w-md animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <LogoMark />
          <a
            href={api.logoutUrl()}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </a>
        </div>

        <div className="rounded-2xl border border-border bg-surface/80 p-6 shadow-pop backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            Welcome to Scry
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">
            Which team are you on?
          </h1>
          <p className="mt-1 text-sm text-muted">
            Ask to join your team, or create a new one. Until someone approves it, you can look
            around but not change anything.
          </p>

          {!noTeams && (
            <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1">
              {(
                [
                  { id: "join", label: "Ask to join", icon: Users },
                  { id: "create", label: "Create a team", icon: Plus },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={cn(
                    "focus-ring flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm transition-colors",
                    mode === id
                      ? "bg-elevated text-foreground shadow-card"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}

          {effectiveMode === "join" ? (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (teamId && !join.isPending) join.mutate();
              }}
            >
              <div className="flex max-h-[min(22rem,45vh)] flex-col gap-1.5 overflow-y-auto pr-1 mask-[linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] pb-4">
                {teamsLoading &&
                  Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}
                {teams?.map((t) => (
                  <label
                    key={t.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                      teamId === t.id
                        ? "border-accent/60 bg-accent/10"
                        : "border-border hover:border-border-strong hover:bg-elevated",
                    )}
                  >
                    <input
                      type="radio"
                      name="team"
                      value={t.id}
                      checked={teamId === t.id}
                      onChange={() => setTeamId(t.id)}
                      className="sr-only"
                    />
                    <Avatar id={t.id} name={t.name} square />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                      {(t.orgUnit || t.country) && (
                        <p className="truncate text-xs text-muted">
                          {[t.orgUnit, t.country].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full border-2 transition-colors",
                        teamId === t.id ? "border-accent bg-accent" : "border-border-strong",
                      )}
                    />
                  </label>
                ))}
              </div>
              {error && <ErrorNote>{error.message}</ErrorNote>}
              <p className="text-xs text-subtle">The team&apos;s admins approve new members.</p>
              <Button type="submit" variant="primary" disabled={!teamId || join.isPending}>
                {join.isPending ? "Sending…" : "Ask to join"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && orgUnit && country && !create.isPending) create.mutate();
              }}
            >
              {noTeams && (
                <p className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-muted">
                  You&apos;re the first one here — create your team to get started.
                </p>
              )}
              <Input
                autoFocus
                icon={<Users className="h-4 w-4" />}
                placeholder="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Org unit"
                  icon={<Building2 className="h-4 w-4" />}
                  value={orgUnit}
                  onChange={(e) => setOrgUnit(e.target.value)}
                >
                  <option value="">Org unit…</option>
                  {options?.orgUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Country"
                  icon={<Globe className="h-4 w-4" />}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="">Country…</option>
                  {options?.countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              {error && <ErrorNote>{error.message}</ErrorNote>}
              <p className="text-xs text-subtle">
                An admin approves new teams. You&apos;ll be its team admin, and approve who joins.
              </p>
              <Button
                type="submit"
                variant="primary"
                disabled={!name.trim() || !orgUnit || !country || create.isPending}
              >
                {create.isPending ? "Sending…" : "Ask for this team"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </SplashShell>
  );
}
