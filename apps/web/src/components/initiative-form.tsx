"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link2, Sparkles, Target, UserRound, Users } from "lucide-react";
import {
  INITIATIVE_STATUSES,
  INITIATIVE_TIERS,
  type Initiative,
  type InitiativeAssist,
  type InitiativeStatus,
  type InitiativeTier,
} from "@scry/shared";
import type { InitiativeInput } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLlmStatus, useTagsInUse, useTeams, useUsers } from "@/lib/queries";
import { STATUS_META, TIER_LABEL } from "@/lib/format";
import { Dialog } from "./ui/dialog";
import { Field, TagInput, Textarea } from "./ui/form";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { ErrorNote, Skeleton, Spinner } from "./ui/feedback";
import { SimilarWork } from "./similar-work";
import { DraftFromDescription, Suggestions } from "./initiative-assist";
import { useWorkspace } from "./workspace";
import { queueQuestion } from "@/lib/ask";

interface FormState {
  title: string;
  summary: string;
  status: InitiativeStatus;
  tier: InitiativeTier;
  teamId: string;
  contactPerson: string;
  startDate: string;
  targetDate: string;
  tags: string[];
  externalLink: string;
  holdReason: string;
}

function toState(
  initial: Partial<Initiative> | undefined,
  defaults: { teamId: string; userId: string },
): FormState {
  return {
    title: initial?.title ?? "",
    summary: initial?.summary ?? "",
    status: initial?.status ?? "idea",
    tier: initial?.tier ?? "tactical",
    teamId: initial?.teamId ?? defaults.teamId,
    contactPerson: initial?.contactPerson ?? defaults.userId,
    startDate: initial?.startDate?.slice(0, 10) ?? "",
    targetDate: initial?.targetDate?.slice(0, 10) ?? "",
    tags: initial?.tags ?? [],
    externalLink: initial?.externalLink ?? "",
    holdReason: initial?.holdReason ?? "",
  };
}

function validate(s: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!s.title.trim()) errors.title = "A title is required";
  if (!s.teamId) errors.teamId = "Choose who owns it";
  else if (s.title.length > 200) errors.title = "Keep it under 200 characters";
  if (!s.summary.trim()) errors.summary = "A summary is required";
  if (s.startDate && s.targetDate && s.targetDate < s.startDate) {
    errors.targetDate = "Target date is before the start date";
  }
  if (s.externalLink) {
    try {
      const url = new URL(s.externalLink);
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      errors.externalLink = "Enter a full http(s) URL";
    }
  }
  return errors;
}

export function InitiativeFormDialog({
  open,
  onClose,
  mode,
  initial,
  defaults,
  onSubmit,
  drafting = false,
  onSkipDraft,
  draftNote,
  canChangeTeam = false,
}: {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit" | "register";
  initial?: Partial<Initiative>;
  defaults: { teamId: string; userId: string };
  /** Resolves when saved; a rejection's message is shown in the form. */
  onSubmit: (input: InitiativeInput) => Promise<unknown>;
  /** True while an LLM draft is being generated — fields show a skeleton. */
  drafting?: boolean;
  /** Stop waiting for the draft and fill the form in by hand. */
  onSkipDraft?: () => void;
  draftNote?: string;
  /** Admins (who have no team) choose an owner, and the work goes to their team. */
  canChangeTeam?: boolean;
}) {
  const { data: teams } = useTeams();
  const { data: users } = useUsers();
  const { data: tagsInUse } = useTagsInUse();
  const [state, setState] = useState(() => toState(initial, defaults));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiOn = useLlmStatus().data?.configured === true;
  const { navigate } = useWorkspace();
  // The form as it was before an AI draft was applied, for Undo.
  const [beforeDraft, setBeforeDraft] = useState<FormState | null>(null);
  const [coverage, setCoverage] = useState<InitiativeAssist["coverage"] | null>(null);

  // Re-seed when the dialog (re)opens or a draft arrives.
  useEffect(() => {
    if (open) {
      setState(toState(initial, defaults));
      setTouched(false);
      setError(null);
      setBeforeDraft(null);
      setCoverage(null);
    }
    // `defaults` is deliberately not a dependency: it's rebuilt every render.
  }, [open, initial]);

  const errors = validate(state);
  const shownErrors = touched ? errors : {};
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  // The contact must be on the owning team (or you). A contact saved before
  // that rule stays listed so an edit doesn't silently change it.
  const savedContact = initial?.contactPerson;
  const contactOptions = useMemo(
    () =>
      (users ?? [])
        .filter(
          (u) => u.teamId === state.teamId || u.id === defaults.userId || u.id === savedContact,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, state.teamId, defaults.userId, savedContact],
  );

  // A new initiative can't start out cancelled (an existing one keeps its status).
  const statusOptions = INITIATIVE_STATUSES.filter(
    (s) => mode === "edit" || s !== "cancelled" || initial?.status === s,
  );
  const teamName = teams?.find((t) => t.id === state.teamId)?.name;

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setError(null);
    try {
      const input: InitiativeInput = {
        title: state.title.trim(),
        summary: state.summary.trim(),
        status: state.status,
        tier: state.tier,
        teamId: state.teamId || undefined,
        contactPerson: state.contactPerson || undefined,
        tags: state.tags,
        // In edit mode an emptied field must be cleared, so send null.
        startDate: state.startDate || (mode === "edit" ? null : undefined),
        targetDate: state.targetDate || (mode === "edit" ? null : undefined),
        externalLink: state.externalLink.trim() || (mode === "edit" ? null : undefined),
        holdReason: state.status === "on_hold" ? state.holdReason.trim() || null : null,
      };
      await onSubmit(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === "edit"
      ? "Edit initiative"
      : mode === "register"
        ? "Register this idea"
        : "New initiative";
  const description =
    mode === "register"
      ? "Check the details before saving. Every team will be able to see it."
      : mode === "create"
        ? "Make it visible to every team, so overlapping work gets caught early."
        : undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving || drafting}>
            {saving && <Spinner className="h-3.5 w-3.5 text-white" />}
            {mode === "edit"
              ? "Save changes"
              : mode === "register"
                ? "Register initiative"
                : "Create initiative"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "register" && (
          <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-xs text-muted sm:col-span-2">
            {drafting ? (
              <Spinner className="mt-0.5 h-3.5 w-3.5" />
            ) : (
              <Sparkles className="mt-0.5 h-3.5 w-3.5 text-accent" />
            )}
            <span className="flex-1">
              {drafting ? "Drafting from your conversation…" : (draftNote ?? "Drafted by Scry.")}
            </span>
            {drafting && onSkipDraft && (
              <button
                type="button"
                onClick={onSkipDraft}
                className="focus-ring rounded-sm font-medium text-foreground hover:underline"
              >
                Skip, I'll write it
              </button>
            )}
          </div>
        )}

        {mode === "create" && aiOn && (
          <DraftFromDescription
            drafted={beforeDraft !== null}
            onDraft={(d) => {
              setBeforeDraft((prev) => prev ?? state);
              setState((s) => ({
                ...s,
                title: d.title,
                summary: d.summary,
                tier: d.tier,
                tags: [...new Set([...s.tags, ...d.tags])],
              }));
              setCoverage(d.coverage);
            }}
            onAsk={(description) => {
              const question =
                description.trim() || [state.title, state.summary].filter(Boolean).join(". ");
              onClose();
              navigate({ view: "chat", chat: null });
              if (question.trim()) queueQuestion(question);
            }}
            onUndo={() => {
              if (beforeDraft) setState(beforeDraft);
              setBeforeDraft(null);
              setCoverage(null);
            }}
          />
        )}

        <Field label="Title" error={shownErrors.title} className="sm:col-span-2">
          {drafting ? (
            <Skeleton className="h-9" />
          ) : (
            <Input
              autoFocus
              value={state.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Unified checkout SDK"
              maxLength={200}
            />
          )}
        </Field>

        <Field
          label="Summary"
          error={shownErrors.summary}
          hint="What it is, who it's for, why it matters. This is what semantic search matches on."
          className="sm:col-span-2"
        >
          {drafting ? (
            <Skeleton className="h-24" />
          ) : (
            <Textarea
              value={state.summary}
              onChange={(e) => set("summary", e.target.value)}
              rows={4}
              maxLength={5000}
            />
          )}
        </Field>

        {aiOn && !drafting && (
          <Suggestions
            fields={{
              title: state.title,
              summary: state.summary,
              tags: state.tags,
              tier: state.tier,
            }}
            onApply={(patch) => setState((s) => ({ ...s, ...patch }))}
            coverage={coverage}
            onCoverage={setCoverage}
          />
        )}

        {mode === "create" && <SimilarWork title={state.title} summary={state.summary} />}

        <Field label="Status">
          <Select
            value={state.status}
            onChange={(e) => set("status", e.target.value as InitiativeStatus)}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tier">
          <Select
            icon={<Target className="h-3.5 w-3.5" />}
            value={state.tier}
            onChange={(e) => set("tier", e.target.value as InitiativeTier)}
          >
            {INITIATIVE_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        {state.status === "on_hold" && (
          <Field
            label="Why is it on hold?"
            hint="Optional. Shown to other teams, so they know what's going on."
            className="sm:col-span-2"
          >
            <Input
              value={state.holdReason}
              onChange={(e) => set("holdReason", e.target.value)}
              placeholder="e.g. Paused until the new session service is ready"
              maxLength={500}
            />
          </Field>
        )}

        {canChangeTeam ? (
          // Admins aren't in a team: they file work for someone, and it goes
          // to that person's team with them as the contact.
          <Field
            label="Owner"
            error={shownErrors.teamId}
            hint={
              state.teamId
                ? `Filed under ${teamName ?? "their team"}; the owner is the contact other teams talk to.`
                : "Anyone in a team. The initiative goes to their team."
            }
            className="sm:col-span-2"
          >
            <OwnerPicker
              value={state.contactPerson}
              onChange={(u) =>
                setState((s) => ({ ...s, contactPerson: u.id, teamId: u.teamId ?? "" }))
              }
            />
          </Field>
        ) : (
          <>
            <Field label="Owning team" hint="Your team. An admin can file work under another.">
              <FixedValue icon={<Users className="h-3.5 w-3.5" />}>{teamName ?? "—"}</FixedValue>
            </Field>

            <Field label="Contact person" hint="Who other teams should talk to.">
              {contactOptions.length === 1 ? (
                // Nobody else to pick (e.g. the only member of the team): no dropdown.
                <FixedValue icon={<UserRound className="h-3.5 w-3.5" />}>
                  {contactOptions[0]?.name}
                </FixedValue>
              ) : (
                <Select
                  icon={<UserRound className="h-3.5 w-3.5" />}
                  value={state.contactPerson}
                  onChange={(e) => set("contactPerson", e.target.value)}
                >
                  {contactOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.teamId !== state.teamId ? " (other team)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        <Field label="Start date">
          <Input
            type="date"
            value={state.startDate}
            onChange={(e) => set("startDate", e.target.value)}
          />
        </Field>

        <Field label="Target date" error={shownErrors.targetDate}>
          <Input
            type="date"
            value={state.targetDate}
            onChange={(e) => set("targetDate", e.target.value)}
          />
        </Field>

        <Field label="Tags" hint="Teams can subscribe to tags." className="sm:col-span-2">
          {drafting ? (
            <Skeleton className="h-9" />
          ) : (
            <TagInput
              label="Tags"
              value={state.tags}
              onChange={(tags) => set("tags", tags)}
              suggestions={tagsInUse ?? []}
            />
          )}
        </Field>

        <Field
          label="External link"
          error={shownErrors.externalLink}
          hint="Optional — a Jira epic or doc. Never a dependency."
          className="sm:col-span-2"
        >
          <Input
            icon={<Link2 className="h-4 w-4" />}
            value={state.externalLink}
            onChange={(e) => set("externalLink", e.target.value)}
            placeholder="https://"
          />
        </Field>

        {error && <ErrorNote className="sm:col-span-2">{error}</ErrorNote>}
        {/* Enter in a single-line field submits. */}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

/** A value the user can't change here, shown as text rather than a disabled control. */
function FixedValue({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 px-0.5 text-sm text-foreground">
      <span className="text-subtle">{icon}</span>
      {children}
    </div>
  );
}

/** Search anyone in a team to own an initiative (admins only). */
function OwnerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (user: { id: string; teamId: string | null }) => void;
}) {
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const teamName = (id: string | null) => teams?.find((t) => t.id === id)?.name;
  const selected = users?.find((u) => u.id === value && u.teamId);
  const q = query.trim().toLowerCase();
  const matches = (users ?? [])
    .filter((u) => u.teamId)
    .filter(
      (u) =>
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (teamName(u.teamId) ?? "").toLowerCase().includes(q),
    )
    .slice(0, 8);
  return (
    <div className="relative">
      <Input
        icon={<UserRound className="h-3.5 w-3.5" />}
        role="combobox"
        aria-label="Owner"
        aria-expanded={open}
        placeholder={
          selected
            ? `${selected.name} · ${teamName(selected.teamId) ?? ""}`
            : "Search people by name, email or team…"
        }
        value={
          open ? query : selected ? `${selected.name} · ${teamName(selected.teamId) ?? ""}` : query
        }
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-elevated p-1 shadow-pop"
        >
          {matches.map((u) => (
            <li
              key={u.id}
              role="option"
              aria-selected={u.id === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(u);
                setOpen(false);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                u.id === value ? "bg-accent/15" : "hover:bg-surface",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{u.name}</span>
              <span className="truncate text-xs text-subtle">{teamName(u.teamId)}</span>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-subtle">Nobody in a team matches.</li>
          )}
        </ul>
      )}
    </div>
  );
}
