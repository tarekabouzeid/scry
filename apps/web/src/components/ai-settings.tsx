"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  Copy,
  Database,
  Fingerprint,
  Gauge,
  KeyRound,
  Plus,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unplug,
  UserRound,
  Wand2,
  XCircle,
} from "lucide-react";
import type {
  LlmAdminView,
  LlmAuthMode,
  LlmRole,
  LlmSecretsInput,
  LlmSettings,
  LlmTestResult,
} from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryKeys, useInvalidateInitiatives } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Field, Textarea } from "./ui/form";
import { ErrorNote, Skeleton, Spinner } from "./ui/feedback";
import { useToast } from "./ui/toast";
import { AiUsage } from "./ai-usage";

const AUTH_MODES: { id: LlmAuthMode; label: string; description: string; icon: ReactNode }[] = [
  {
    id: "none",
    label: "No authentication",
    description: "Local models (Ollama, vLLM) or the bundled demo LLM.",
    icon: <Unplug className="h-4 w-4" />,
  },
  {
    id: "api_key",
    label: "API key",
    description: "A static key — e.g. a LiteLLM virtual key or an OpenAI key.",
    icon: <KeyRound className="h-4 w-4" />,
  },
  {
    id: "oauth2_client_credentials",
    label: "JWT from your IdP",
    description: "Scry fetches a token with OAuth2 client credentials (LiteLLM JWT auth).",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    id: "signed_jwt",
    label: "JWT signed by Scry",
    description: "Scry signs short-lived RS256 tokens; the gateway checks Scry's JWKS.",
    icon: <Fingerprint className="h-4 w-4" />,
  },
];

const PRESETS = [
  { label: "LiteLLM", url: "http://litellm:4000/v1" },
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "Demo LLM", url: "http://demo-llm:4010/v1" },
  { label: "Ollama", url: "http://host.docker.internal:11434/v1" },
];

const ROLES: {
  id: LlmRole;
  title: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    id: "embedding",
    title: "Embeddings",
    description: "Indexes initiatives for semantic search and overlap detection.",
    icon: <Database className="h-4 w-4" />,
  },
  {
    id: "assistant",
    title: "Ask Scry assistant",
    description: "Answers “does this already exist?” — explains matches and names who to talk to.",
    icon: <Bot className="h-4 w-4" />,
  },
  {
    id: "tasks",
    title: "Tasks",
    description: "Background work such as drafting an initiative from a chat.",
    icon: <Wand2 className="h-4 w-4" />,
  },
];

function Section({
  icon,
  title,
  description,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-accent">
            {icon}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A write-only secret: shows whether one is stored, never its value. */
function SecretField({
  label,
  stored,
  value,
  onChange,
  hint,
}: {
  label: string;
  stored: boolean;
  /** undefined = keep stored, "" = clear, otherwise the new value. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  hint?: string;
}) {
  const clearing = value === "" && stored;
  return (
    <Field
      label={label}
      hint={
        clearing
          ? "Will be removed when you save."
          : stored && value === undefined
            ? "Stored encrypted. Leave blank to keep it."
            : hint
      }
    >
      <Input
        type="password"
        autoComplete="new-password"
        placeholder={stored && !clearing ? "•••••••••••• (stored)" : "Paste it here"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        trailing={
          stored &&
          (clearing ? (
            <button
              type="button"
              className="shrink-0 text-xs text-accent hover:underline"
              onClick={() => onChange(undefined)}
            >
              Keep
            </button>
          ) : (
            <button
              type="button"
              className="shrink-0 text-xs text-subtle hover:text-status-blocked"
              onClick={() => onChange("")}
            >
              Remove
            </button>
          ))
        }
      />
    </Field>
  );
}

function CopyValue({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-xs text-foreground">
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <button
        type="button"
        aria-label="Copy"
        className="shrink-0 text-subtle hover:text-foreground"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast({ tone: "success", message: "Copied" });
          } catch {
            toast({ tone: "error", message: "Couldn't access the clipboard" });
          }
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function HeadersEditor({
  value,
  onChange,
}: {
  value: [string, string][];
  onChange: (value: [string, string][]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map(([name, v], i) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder="x-litellm-tags"
            value={name}
            onChange={(e) => onChange(value.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))}
            className="w-2/5"
          />
          <Input
            placeholder="value"
            value={v}
            onChange={(e) => onChange(value.map((h, j) => (j === i ? [h[0], e.target.value] : h)))}
            className="flex-1"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Remove header"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...value, ["", ""]])}>
        <Plus className="h-3.5 w-3.5" />
        Add header
      </Button>
    </div>
  );
}

function TestResults({
  results,
  onUseDimensions,
}: {
  results: LlmTestResult[];
  onUseDimensions: (dimensions: number) => void;
}) {
  return (
    <ul className="divide-y divide-border/70 rounded-lg border border-border bg-background/50">
      {results.map((r) => {
        const role = ROLES.find((x) => x.id === r.role)!;
        return (
          <li key={r.role} className="flex items-start gap-3 px-3 py-2.5 text-sm">
            {r.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-shipped" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-status-blocked" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {role.title}{" "}
                <span className="font-mono text-xs font-normal text-subtle">{r.model}</span>
              </p>
              <p className={cn("text-xs", r.ok ? "text-muted" : "text-status-blocked")}>
                {r.ok ? r.detail : r.error}
              </p>
              {r.actualDimensions && (
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => onUseDimensions(r.actualDimensions!)}
                >
                  Use {r.actualDimensions} dimensions
                </Button>
              )}
            </div>
            <span className="shrink-0 font-mono text-[11px] text-subtle">{r.latencyMs} ms</span>
          </li>
        );
      })}
    </ul>
  );
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const SOURCE_LABEL: Record<LlmAdminView["source"], string> = {
  database: "Configured here",
  environment: "From environment variables",
  none: "Not configured",
};

function StatusHeader({ view }: { view: LlmAdminView }) {
  const configured = view.source !== "none";
  const { total, indexed } = view.indexing;
  const pct = total ? Math.round((indexed / total) * 100) : 100;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-card">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            configured ? "bg-status-shipped/15 text-status-shipped" : "bg-warning/15 text-warning",
          )}
        >
          <PlugZap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{SOURCE_LABEL[view.source]}</p>
          <p className="text-xs text-muted">
            {view.source === "database" && view.updatedAt
              ? `Last changed ${relativeTime(view.updatedAt)}${view.updatedBy ? ` by ${view.updatedBy.name}` : ""}`
              : view.source === "environment"
                ? "Saving here takes over from the LLM_* variables."
                : "Ask Scry, semantic search and overlap detection are off until you connect a model."}
          </p>
        </div>
      </div>
      {configured && (
        <div className="min-w-48 flex-1">
          <div className="flex justify-between text-xs text-muted">
            <span>Indexed initiatives</span>
            <span className="font-mono">
              {indexed}/{total}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full bg-accent-gradient transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AiSettingsForm({ view }: { view: LlmAdminView }) {
  const queryClient = useQueryClient();
  const invalidateInitiatives = useInvalidateInitiatives();
  const toast = useToast();

  const [draft, setDraft] = useState<LlmSettings>(view.settings);
  const [headers, setHeaders] = useState<[string, string][]>(() =>
    Object.entries(view.settings.connection.headers),
  );
  const [claims, setClaims] = useState(() =>
    JSON.stringify(view.settings.connection.auth.extraClaims, null, 2),
  );
  const [secrets, setSecrets] = useState<LlmSecretsInput>({});
  const [results, setResults] = useState<LlmTestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Re-seed when the saved settings change (save / reset) — not on every
  // poll while indexing runs, which would wipe unsaved edits.
  // Key rotation also bumps updatedAt but not the settings, so it's left out.
  const savedVersion = `${view.source}:${JSON.stringify(view.settings)}`;
  useEffect(() => {
    setDraft(view.settings);
    setHeaders(Object.entries(view.settings.connection.headers));
    setClaims(JSON.stringify(view.settings.connection.auth.extraClaims, null, 2));
    setSecrets({});
    // view.settings is covered by savedVersion.
  }, [savedVersion]);

  const auth = draft.connection.auth;
  const setConnection = (patch: Partial<LlmSettings["connection"]>) =>
    setDraft((d) => ({ ...d, connection: { ...d.connection, ...patch } }));
  const setAuth = (patch: Partial<LlmSettings["connection"]["auth"]>) =>
    setDraft((d) => ({
      ...d,
      connection: { ...d.connection, auth: { ...d.connection.auth, ...patch } },
    }));
  const setModel = <R extends LlmRole>(role: R, patch: Partial<LlmSettings["models"][R]>) =>
    setDraft((d) => ({
      ...d,
      models: { ...d.models, [role]: { ...d.models[role], ...patch } },
    }));
  const setMatching = (patch: Partial<LlmSettings["matching"]>) =>
    setDraft((d) => ({ ...d, matching: { ...d.matching, ...patch } }));

  /** The draft as the api expects it, or an error to show. */
  const build = (): LlmSettings | string => {
    let extraClaims: Record<string, unknown>;
    if (auth.mode === "signed_jwt" && claims.trim()) {
      try {
        const parsed: unknown = JSON.parse(claims);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return "Extra claims must be a JSON object";
        }
        extraClaims = parsed as Record<string, unknown>;
      } catch {
        return "Extra claims aren't valid JSON";
      }
    } else {
      extraClaims = auth.extraClaims;
    }
    const headerMap = Object.fromEntries(
      headers.filter(([name]) => name.trim()).map(([n, v]) => [n.trim(), v]),
    );
    return {
      ...draft,
      connection: { ...draft.connection, headers: headerMap, auth: { ...auth, extraClaims } },
    };
  };

  const embeddingChanged =
    view.source !== "none" &&
    (draft.models.embedding.model !== view.settings.models.embedding.model ||
      draft.models.embedding.dimensions !== view.settings.models.embedding.dimensions ||
      draft.models.embedding.shorten !== view.settings.models.embedding.shorten ||
      draft.models.embedding.queryPrefix !== view.settings.models.embedding.queryPrefix ||
      draft.models.embedding.documentPrefix !== view.settings.models.embedding.documentPrefix ||
      draft.connection.baseUrl.replace(/\/+$/, "") !==
        view.settings.connection.baseUrl.replace(/\/+$/, ""));

  const dirty = useMemo(() => {
    const built = build();
    return (
      typeof built === "string" ||
      JSON.stringify(built) !== JSON.stringify(view.settings) ||
      Object.values(secrets).some((v) => v !== undefined)
    );
    // `build` reads draft/headers/claims, listed here.
  }, [draft, headers, claims, secrets, view.settings]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.llmSettings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.llmStatus }),
    ]);
  };

  const test = useMutation({
    mutationFn: (settings: LlmSettings) => api.testLlmSettings(settings, secrets),
    onMutate: () => setResults(null),
    onSuccess: (r) => setResults(r),
    onError: (err) => setError(err.message),
  });

  const save = useMutation({
    mutationFn: (settings: LlmSettings) => api.saveLlmSettings(settings, secrets),
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.llmSettings, res);
      setSecrets({}); // stored now; the fields go back to "leave blank to keep"
      await refresh();
      await invalidateInitiatives();
      toast({
        tone: "success",
        message: res.reindex.reset
          ? `Saved — the embedding model changed, so all ${res.reindex.queued} initiatives are being re-indexed`
          : res.reindex.queued
            ? `Saved — indexing ${res.reindex.queued} initiative${res.reindex.queued === 1 ? "" : "s"}`
            : "Saved",
      });
    },
    onError: (err) => setError(err.message),
  });

  const rotate = useMutation({
    mutationFn: api.rotateLlmSigningKey,
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.llmSettings, res);
      toast({ tone: "success", message: "New signing key published" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  const reindex = useMutation({
    mutationFn: api.reindexLlm,
    onSuccess: async (res) => {
      await refresh();
      await invalidateInitiatives();
      toast({ tone: "success", message: `Re-indexing ${res.queued} initiatives` });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  const reset = useMutation({
    mutationFn: api.resetLlmSettings,
    onSuccess: async (res) => {
      queryClient.setQueryData(queryKeys.llmSettings, res);
      setConfirmReset(false);
      setResults(null);
      await refresh();
      toast({ tone: "success", message: "AI settings removed" });
    },
    onError: (err) => toast({ tone: "error", message: err.message }),
  });

  const run = (action: "test" | "save") => {
    setError(null);
    const built = build();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    (action === "test" ? test : save).mutate(built);
  };

  const jwksUrl = api.url(view.jwksPath);

  return (
    <div className="space-y-4">
      {!view.secretsReadable && (
        <ErrorNote>
          Stored credentials can&apos;t be decrypted — <code>SETTINGS_ENCRYPTION_KEY</code> (or{" "}
          <code>SESSION_SECRET</code>) changed. Re-enter them below and save.
        </ErrorNote>
      )}

      <Section
        icon={<PlugZap className="h-4 w-4" />}
        title="Connection"
        description="Any OpenAI-compatible endpoint: a LiteLLM gateway, OpenAI, Azure, vLLM or Ollama."
      >
        <div className="grid gap-4">
          <Field
            label="Base URL"
            hint="As the Scry api reaches it — inside Docker, use the service name (http://litellm:4000/v1), not localhost."
          >
            <Input
              value={draft.connection.baseUrl}
              onChange={(e) => setConnection({ baseUrl: e.target.value })}
              placeholder="http://litellm:4000/v1"
              spellCheck={false}
            />
          </Field>
          {view.allowedHosts && (
            <p className="-mt-2 text-xs text-subtle">
              This deployment only allows AI traffic to{" "}
              <span className="font-mono text-muted">{view.allowedHosts.join(", ")}</span>{" "}
              (LLM_ALLOWED_HOSTS).
            </p>
          )}
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setConnection({ baseUrl: p.url })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  draft.connection.baseUrl === p.url
                    ? "border-accent/50 bg-accent/10 text-foreground"
                    : "border-border text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted">Authentication</p>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {AUTH_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={auth.mode === m.id}
                  onClick={() =>
                    setAuth({
                      mode: m.id,
                      // LiteLLM's default JWT_AUDIENCE; a required field left blank otherwise.
                      ...(m.id === "signed_jwt" && !auth.audience && { audience: "litellm" }),
                    })
                  }
                  className={cn(
                    "focus-ring flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    auth.mode === m.id
                      ? "border-accent/60 bg-accent/5 ring-1 ring-accent/30"
                      : "border-border hover:border-border-strong hover:bg-elevated/50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 shrink-0",
                      auth.mode === m.id ? "text-accent" : "text-subtle",
                    )}
                  >
                    {m.icon}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">{m.label}</span>
                    <span className="block text-xs text-muted">{m.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {auth.mode === "api_key" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SecretField
                label="API key"
                stored={view.secrets.apiKey}
                value={secrets.apiKey}
                onChange={(apiKey) => setSecrets((s) => ({ ...s, apiKey }))}
              />
              <Field
                label="Header"
                hint={
                  auth.headerName.toLowerCase() === "authorization"
                    ? "Sent as “Bearer <key>”."
                    : "Sent as the raw key (Azure uses api-key)."
                }
              >
                <Input
                  value={auth.headerName}
                  onChange={(e) => setAuth({ headerName: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            </div>
          )}

          {auth.mode === "oauth2_client_credentials" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Token URL"
                hint="e.g. https://sso.example.com/realms/acme/protocol/openid-connect/token"
                className="sm:col-span-2"
              >
                <Input
                  value={auth.tokenUrl}
                  onChange={(e) => setAuth({ tokenUrl: e.target.value })}
                  spellCheck={false}
                />
              </Field>
              <Field label="Client ID">
                <Input
                  value={auth.clientId}
                  onChange={(e) => setAuth({ clientId: e.target.value })}
                  spellCheck={false}
                />
              </Field>
              <SecretField
                label="Client secret"
                stored={view.secrets.clientSecret}
                value={secrets.clientSecret}
                onChange={(clientSecret) => setSecrets((s) => ({ ...s, clientSecret }))}
              />
              <Field label="Scope" hint="Optional, space-separated.">
                <Input value={auth.scope} onChange={(e) => setAuth({ scope: e.target.value })} />
              </Field>
              <Field label="Audience" hint="Optional — some IdPs (Auth0, Okta) need one.">
                <Input
                  value={auth.audience}
                  onChange={(e) => setAuth({ audience: e.target.value })}
                />
              </Field>
              <Field label="Client authentication">
                <Select
                  value={auth.clientAuthMethod}
                  onChange={(e) =>
                    setAuth({
                      clientAuthMethod: e.target.value as typeof auth.clientAuthMethod,
                    })
                  }
                >
                  <option value="client_secret_basic">HTTP Basic (client_secret_basic)</option>
                  <option value="client_secret_post">Form body (client_secret_post)</option>
                </Select>
              </Field>
              <p className="self-end text-xs text-subtle">
                Scry caches the token and fetches a new one shortly before it expires.
              </p>
            </div>
          )}

          {auth.mode === "signed_jwt" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issuer (iss)">
                <Input value={auth.issuer} onChange={(e) => setAuth({ issuer: e.target.value })} />
              </Field>
              <Field label="Audience (aud)" hint="What the gateway expects, e.g. litellm.">
                <Input
                  value={auth.audience}
                  onChange={(e) => setAuth({ audience: e.target.value })}
                />
              </Field>
              <Field label="Subject (sub)">
                <Input
                  value={auth.subject}
                  onChange={(e) => setAuth({ subject: e.target.value })}
                />
              </Field>
              <Field label="Token lifetime (seconds)">
                <Input
                  type="number"
                  min={60}
                  max={86400}
                  value={auth.ttlSeconds}
                  onChange={(e) => setAuth({ ttlSeconds: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Extra claims (JSON)"
                hint='e.g. {"scope": "litellm_proxy_admin"} or a team_id your gateway maps.'
                className="sm:col-span-2"
              >
                <Textarea
                  value={claims}
                  onChange={(e) => setClaims(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <div className="space-y-3 rounded-lg border border-border bg-elevated/40 p-4 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Signing key</p>
                    <p className="text-xs text-muted">
                      {view.signingKey ? (
                        <>
                          RS256 ·{" "}
                          <span className="font-mono">{view.signingKey.keyId.slice(0, 12)}…</span> ·
                          created {relativeTime(view.signingKey.createdAt)}
                        </>
                      ) : (
                        "No key yet — generate one, then register the JWKS URL with your gateway."
                      )}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
                    {rotate.isPending ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {view.signingKey ? "Rotate key" : "Generate key"}
                  </Button>
                </div>
                {view.signingKey?.activatesAt && (
                  <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                    The new key is published now and starts signing{" "}
                    {new Date(view.signingKey.activatesAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    , so gateways that cache the JWKS have picked it up first. Until then the
                    previous key keeps signing.
                  </p>
                )}
                <Field
                  label="JWKS URL"
                  hint="Public keys only. Use the address your gateway can reach."
                >
                  <CopyValue value={jwksUrl} />
                </Field>
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer select-none text-foreground">
                    LiteLLM setup
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                    {`# litellm config.yaml
general_settings:
  enable_jwt_auth: True

# litellm environment
JWT_PUBLIC_KEY_URL=${jwksUrl}
JWT_AUDIENCE=${auth.audience || "litellm"}`}
                  </pre>
                </details>
              </div>
            </div>
          )}

          <details className="group rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted group-open:mb-3">
              Advanced — timeout and custom headers
            </summary>
            <div className="grid gap-4">
              <Field label="Timeout (seconds)" className="sm:w-48">
                <Input
                  type="number"
                  min={1}
                  max={600}
                  value={Math.round(draft.connection.timeoutMs / 1000)}
                  onChange={(e) => setConnection({ timeoutMs: Number(e.target.value) * 1000 })}
                />
              </Field>
              <Field
                label="Custom headers"
                hint="Sent with every request (e.g. LiteLLM tags or an org header). Not for secrets — they're shown here in plain text."
              >
                <HeadersEditor value={headers} onChange={setHeaders} />
              </Field>
            </div>
          </details>
        </div>
      </Section>

      <Section
        icon={<Bot className="h-4 w-4" />}
        title="Models"
        description="Use gateway model names (LiteLLM model aliases) or provider model IDs. Each role can use a different model."
      >
        <div className="divide-y divide-border/70">
          {ROLES.map((role) => (
            <div
              key={role.id}
              className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_1.4fr]"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-accent">{role.icon}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{role.title}</p>
                  <p className="text-xs text-muted">{role.description}</p>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <Input
                  aria-label={`${role.title} model`}
                  value={draft.models[role.id].model}
                  onChange={(e) => setModel(role.id, { model: e.target.value })}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                {role.id === "embedding" ? (
                  <Input
                    aria-label="Dimensions"
                    type="number"
                    min={1}
                    max={16000}
                    placeholder="Dims"
                    title="The size of the vectors this model returns."
                    value={draft.models.embedding.dimensions || ""}
                    onChange={(e) =>
                      setModel("embedding", { dimensions: Number(e.target.value) || 0 })
                    }
                    trailing={<span className="text-[10px] text-subtle">dims</span>}
                  />
                ) : (
                  <Input
                    aria-label={`${role.title} temperature`}
                    type="number"
                    step={0.1}
                    min={0}
                    max={2}
                    placeholder="Temp."
                    title="Temperature — leave blank for the model's default."
                    value={draft.models[role.id as "assistant" | "tasks"].temperature ?? ""}
                    onChange={(e) =>
                      setModel(role.id as "assistant" | "tasks", {
                        temperature: numberOrNull(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-2 text-xs text-subtle">
          <p>
            Dims is the size of the vectors the embedding model returns — 1536 for OpenAI&apos;s
            text-embedding-3-small, 768 for nomic-embed-text, 1024 for bge-m3. Not sure? Run{" "}
            <em>Test connection</em>: it reports the real size and can fill it in.
          </p>
          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              checked={draft.models.embedding.shorten}
              onChange={(e) => setModel("embedding", { shorten: e.target.checked })}
            />
            Ask the model to shorten its vectors to this size (OpenAI text-embedding-3 models only)
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Search prefix"
            hint="Put before every search. EmbeddingGemma: “task: search result | query: ”."
          >
            <Input
              value={draft.models.embedding.queryPrefix}
              onChange={(e) => setModel("embedding", { queryPrefix: e.target.value })}
              placeholder="None"
              spellCheck={false}
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Initiative prefix"
            hint="Put before every initiative's text. EmbeddingGemma: “title: none | text: ”."
          >
            <Input
              value={draft.models.embedding.documentPrefix}
              onChange={(e) => setModel("embedding", { documentPrefix: e.target.value })}
              placeholder="None"
              spellCheck={false}
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-subtle">
          Many open embedding models are trained with one prefix for searches and another for what
          they search through, and match far worse without them. Check the model&apos;s card; leave
          both empty for OpenAI models.
        </p>
        {embeddingChanged && (
          <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            You changed the embedding model, its prefixes or the endpoint. Vectors made differently
            can&apos;t be compared, so saving re-indexes every initiative; semantic search fills
            back in as that runs.
          </p>
        )}
      </Section>

      <Section
        icon={<Gauge className="h-4 w-4" />}
        title="Matching"
        description="How similar (cosine, 0–1) an idea must be to count as a match. Scores depend on the embedding model, so revisit these when you change it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["strongMatch", "Strong match", "Ask Scry says “this already exists”."],
              ["weakMatch", "Weak match", "Ask Scry says “related — check before building”."],
              ["overlap", "Overlap alert", "Flags two teams' initiatives as a possible duplicate."],
            ] as const
          ).map(([key, label, hint]) => (
            <Field key={key} label={label} hint={hint}>
              <Input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={draft.matching[key]}
                onChange={(e) => setMatching({ [key]: Number(e.target.value) })}
                trailing={
                  <span className="font-mono text-xs text-subtle">
                    {Math.round(draft.matching[key] * 100)}%
                  </span>
                }
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        icon={<UserRound className="h-4 w-4" />}
        title="Usage attribution"
        description="Send who asked with each request (the OpenAI “user” field), so your gateway can attribute spend and apply per-user limits."
      >
        <Select
          value={draft.userTracking}
          onChange={(e) =>
            setDraft((d) => ({ ...d, userTracking: e.target.value as LlmSettings["userTracking"] }))
          }
          className="sm:w-72"
        >
          <option value="off">Don&apos;t send</option>
          <option value="id">Scry user ID (pseudonymous)</option>
          <option value="email">Email address</option>
        </Select>
      </Section>

      {(error || results || test.isPending) && (
        <Section icon={<PlugZap className="h-4 w-4" />} title="Connection test">
          {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
          {test.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Calling each model…
            </p>
          )}
          {results && (
            <TestResults
              results={results}
              onUseDimensions={(dimensions) => {
                setModel("embedding", { dimensions, shorten: false });
                setResults(null);
              }}
            />
          )}
        </Section>
      )}

      {/* Floats within the content column, so it lines up with the cards above. */}
      <div className="sticky bottom-3 z-10 rounded-xl border border-border bg-surface/90 shadow-pop backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          {view.source === "database" && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Remove settings
            </Button>
          )}
          {view.source !== "none" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => reindex.mutate()}
              disabled={reindex.isPending}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-index
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={() => run("test")} disabled={test.isPending}>
            {test.isPending ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            Test connection
          </Button>
          <Button variant="primary" onClick={() => run("save")} disabled={save.isPending || !dirty}>
            {save.isPending && <Spinner className="h-3.5 w-3.5 text-white" />}
            Save
          </Button>
        </div>
      </div>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Remove AI settings?"
        description={
          "Scry forgets this endpoint, its credentials and signing keys. " +
          "It falls back to LLM_* environment variables if they're set; otherwise AI features turn off."
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => reset.mutate()} disabled={reset.isPending}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Existing indexes stay until a model is connected again.
        </p>
      </Dialog>
    </div>
  );
}

export function AiSettings() {
  const {
    data: view,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.llmSettings,
    queryFn: api.llmSettings,
    // Poll while indexing runs, so the progress bar moves.
    refetchInterval: (query) => {
      const v = query.state.data;
      return v && v.source !== "none" && v.indexing.indexed < v.indexing.total ? 2000 : false;
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !view) return <ErrorNote>{error?.message ?? "Couldn't load AI settings"}</ErrorNote>;
  return (
    <div className="space-y-4">
      <StatusHeader view={view} />
      {view.source !== "none" && <AiUsage />}
      <AiSettingsForm view={view} />
    </div>
  );
}
