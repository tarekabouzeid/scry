"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  Copy,
  Hash,
  KeyRound,
  PlugZap,
  Layers,
  Monitor,
  Moon,
  Palette,
  Sun,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { SubscriptionTarget } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  queryKeys,
  useInitiativesById,
  useTagsInUse,
  useTeamLookup,
  useTeams,
} from "@/lib/queries";
import { formatDate, relativeTime } from "@/lib/format";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Field, TagSearch } from "./ui/form";
import { Avatar } from "./ui/avatar";
import { ErrorNote, Skeleton } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { useWorkspace } from "./workspace";
import { McpConnectionsSection } from "./mcp-connections";

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Following() {
  const { user } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: teams } = useTeams();
  const teamOf = useTeamLookup();
  const { data: subs, isLoading } = useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: api.subscriptions,
  });
  const initiativeOf = useInitiativesById(
    (subs ?? []).filter((s) => s.targetType === "initiative").map((s) => s.targetValue),
  );
  const [teamId, setTeamId] = useState("");
  const [tag, setTag] = useState("");
  // Only tags some initiative uses can be followed (the API refuses others).
  const { data: tagsInUse } = useTagsInUse();
  const followedTags = new Set(
    subs?.filter((s) => s.targetType === "tag").map((s) => s.targetValue) ?? [],
  );
  const tagOptions = (tagsInUse ?? []).filter((t) => !followedTags.has(t));
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.subscriptions });

  const add = useMutation({
    mutationFn: ({ type, value }: { type: SubscriptionTarget; value: string }) =>
      api.subscribe(type, value),
    onSuccess: async () => {
      setTeamId("");
      setTag("");
      await refresh();
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const remove = useMutation({ mutationFn: api.unsubscribe, onSuccess: refresh });

  const label = (type: SubscriptionTarget, value: string) =>
    type === "team"
      ? (teamOf(value)?.name ?? "Deleted team")
      : type === "initiative"
        ? (initiativeOf(value)?.title ?? (initiativeOf.isLoading ? "…" : "Deleted initiative"))
        : `#${value}`;
  const ICON = { team: Users, initiative: Layers, tag: Hash };

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-elevated/60 px-3 py-2 text-xs text-muted">
        You&apos;re always notified when someone else flags an overlap with, starts depending on, or
        comments on an initiative you submitted or are the contact for. Follow more below.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (teamId) add.mutate({ type: "team", value: teamId });
          }}
        >
          <Select
            icon={<Users className="h-3.5 w-3.5" />}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="flex-1"
          >
            <option value="">Follow a team…</option>
            {teams
              ?.filter((t) => t.id !== user.teamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
          <Button type="submit" disabled={!teamId || add.isPending}>
            Follow
          </Button>
        </form>
        <TagSearch
          label="Follow a tag"
          placeholder="Follow a tag…"
          value={tag}
          onChange={setTag}
          suggestions={tagOptions}
          onPick={(t) => add.mutate({ type: "tag", value: t })}
        />
      </div>

      {isLoading && <Skeleton className="h-16" />}
      {subs?.length === 0 && (
        <p className="text-xs text-subtle">
          Not following anything yet. Follow single initiatives with the bell in their detail panel.
        </p>
      )}
      {subs && subs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {subs.map((s) => {
            const Icon = ICON[s.targetType];
            return (
              <li
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated/60 py-1 pl-2.5 pr-1 text-xs text-foreground"
              >
                {s.targetType === "team" ? (
                  <Avatar
                    id={s.targetValue}
                    name={label(s.targetType, s.targetValue)}
                    size="xs"
                    square
                  />
                ) : (
                  <Icon className="h-3 w-3 text-subtle" />
                )}
                <span className="max-w-56 truncate">{label(s.targetType, s.targetValue)}</span>
                <button
                  type="button"
                  aria-label="Unfollow"
                  onClick={() => remove.mutate(s.id)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-subtle hover:bg-border hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Tokens() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: tokens, isLoading } = useQuery({
    queryKey: queryKeys.tokens,
    queryFn: api.listTokens,
  });
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  // Read-only unless asked: most tokens feed a script or an AI tool that
  // only needs to look things up.
  const [scope, setScope] = useState<"read" | "write">("read");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tokens });

  const create = useMutation({
    mutationFn: () =>
      api.createToken({
        name: name.trim() || undefined,
        expiresInDays: expiry ? Number(expiry) : undefined,
        scope,
      }),
    onSuccess: async ({ token }) => {
      setCreated(token);
      setCopied(false);
      setName("");
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: api.revokeToken,
    onSuccess: async () => {
      await refresh();
      toast({ tone: "success", message: "Token revoked" });
    },
  });

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      toast({ tone: "error", message: "Couldn't access the clipboard — copy it manually" });
    }
  };

  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Token name">
          <Input
            placeholder="e.g. work laptop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Field>
        <Field label="Access">
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as "read" | "write")}
            aria-label="Token access"
          >
            <option value="read">Read only</option>
            <option value="write">Read and write</option>
          </Select>
        </Field>
        <Field label="Expires">
          <Select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In 1 year</option>
            <option value="">Never</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          <KeyRound className="h-3.5 w-3.5" />
          Create token
        </Button>
      </form>
      {create.error && <ErrorNote>{create.error.message}</ErrorNote>}

      {created && (
        <div className="rounded-lg border border-status-shipped/30 bg-status-shipped/5 p-3 animate-fade-in">
          <p className="text-xs font-medium text-foreground">
            Copy your token now — it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground">
              {created}
            </code>
            <Button size="sm" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <Terminal className="h-3 w-3" />
            Send it as <code className="font-mono">Authorization: Bearer …</code> to the API, or to
            an AI tool&apos;s MCP settings.
          </p>
        </div>
      )}

      {isLoading && <Skeleton className="h-16" />}
      {tokens?.length === 0 && <p className="text-xs text-subtle">No tokens yet.</p>}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-border/70 rounded-lg border border-border">
          {tokens.map((t) => {
            const expired = t.expiresAt && new Date(t.expiresAt).getTime() < Date.now();
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <KeyRound className="h-4 w-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">
                    {t.name ?? "Unnamed token"}
                    <span className="ml-2 rounded-full border border-border px-1.5 py-px text-[10px] text-muted">
                      {t.scope === "write" ? "Read and write" : "Read only"}
                    </span>
                  </p>
                  <p className="text-[11px] text-subtle">
                    Created {relativeTime(t.createdAt)} ·{" "}
                    {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : "never used"} ·{" "}
                    <span className={cn(expired && "text-status-blocked")}>
                      {t.expiresAt
                        ? `${expired ? "expired" : "expires"} ${formatDate(t.expiresAt)}`
                        : "never expires"}
                    </span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke.mutate(t.id)}
                  disabled={revoke.isPending}
                  className="text-status-blocked hover:text-status-blocked"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Appearance() {
  const [pref, setPref] = useTheme();
  const options: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
    { id: "system", label: "System", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:max-w-md">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setPref(id)}
          aria-pressed={pref === id}
          className={cn(
            "focus-ring flex flex-col items-center gap-2 rounded-xl border p-3 text-sm transition-colors",
            pref === id
              ? "border-accent/60 bg-accent/5 text-foreground"
              : "border-border text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="flex max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <Section
        icon={<Bell className="h-4 w-4" />}
        title="Following"
        description="Get notified about teams, tags and initiatives beyond your own."
      >
        <Following />
      </Section>
      <Section
        icon={<PlugZap className="h-4 w-4" />}
        title="AI tools"
        description="Ask Scry from Claude, Cursor, VS Code and other AI assistants, read only."
      >
        <McpConnectionsSection />
      </Section>
      <Section
        icon={<KeyRound className="h-4 w-4" />}
        title="API tokens"
        description="Personal access tokens for scripts and AI tools. They act as you: read only unless you choose otherwise."
      >
        <Tokens />
      </Section>
      <Section
        icon={<Palette className="h-4 w-4" />}
        title="Appearance"
        description="Choose a theme, or follow your operating system."
      >
        <Appearance />
      </Section>
    </div>
  );
}
