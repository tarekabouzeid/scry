"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Plus, RotateCcw, Sparkles, Wand2, X } from "lucide-react";
import type { InitiativeAssist, InitiativeTier } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TIER_LABEL } from "@/lib/format";
import { Button } from "./ui/button";
import { ErrorNote, Kbd, Spinner } from "./ui/feedback";
import { Textarea } from "./ui/form";

export interface AssistFields {
  title: string;
  summary: string;
  tags: string[];
  tier: InitiativeTier;
}

/**
 * Start from a rough description: AI fills in title, summary, tags and
 * tier. Everything stays editable, and one click puts the form back.
 */
export function DraftFromDescription({
  onDraft,
  onUndo,
  onAsk,
  drafted,
}: {
  onDraft: (draft: InitiativeAssist) => void;
  onUndo: () => void;
  /** Leave the form and put the description to Ask Scry instead. */
  onAsk: (description: string) => void;
  /** A draft has been applied and can be undone. */
  drafted: boolean;
}) {
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(true);
  // Stop (or closing the dialog) aborts the request, so a slow model's late
  // answer can't overwrite what the author has typed since.
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const draft = useMutation({
    mutationFn: () => {
      abort.current?.abort();
      abort.current = new AbortController();
      return api.assistInitiative({ mode: "draft", description }, abort.current.signal);
    },
    onSuccess: (d) => {
      onDraft(d);
      setOpen(false);
    },
  });
  const stopped = draft.error instanceof DOMException && draft.error.name === "AbortError";
  const ready = description.trim().length >= 15;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2 text-xs text-muted sm:col-span-2">
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span className="flex-1">
          {drafted
            ? "Filled in by AI from your description. Check it and change anything."
            : "Have a rough description? AI can fill in the fields for you."}
        </span>
        {drafted && (
          <button
            type="button"
            onClick={onUndo}
            className="focus-ring inline-flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline"
          >
            <RotateCcw className="h-3 w-3" />
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring rounded-sm font-medium text-foreground hover:underline"
        >
          {drafted ? "Edit description" : "Draft with AI"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-accent/25 bg-accent/5 p-3 sm:col-span-2">
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Describe it in your own words
        </span>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ready) {
              e.preventDefault();
              draft.mutate();
            }
          }}
          rows={3}
          maxLength={4000}
          placeholder="e.g. Customers keep getting locked out and support resets passwords all day. We want passkeys on web and mobile so people can sign in without a password."
          className="bg-surface"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted">
          AI fills in the title, summary, tags and tier, using only what you wrote.{" "}
          <span className="hidden sm:inline">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to draft.
          </span>
        </p>
        <button
          type="button"
          onClick={() => onAsk(description)}
          className="focus-ring rounded-sm text-xs text-muted underline decoration-border-strong underline-offset-2 hover:text-foreground"
          title="Not sure it's new? Scry checks it against every team's work first."
        >
          Ask Scry first
        </button>
        {draft.isPending ? (
          <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Skip
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={() => draft.mutate()}
          disabled={!ready || draft.isPending}
          title={ready ? undefined : "Write a sentence or two first"}
        >
          {draft.isPending ? (
            <Spinner className="h-3.5 w-3.5 text-white" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {draft.isPending ? "Drafting…" : "Draft"}
        </Button>
      </div>
      {draft.error && !stopped && <ErrorNote className="mt-2">{draft.error.message}</ErrorNote>}
    </div>
  );
}

const COVERAGE: { key: keyof InitiativeAssist["coverage"]; label: string; hint: string }[] = [
  { key: "what", label: "What it is", hint: "Say plainly what will be built or changed." },
  { key: "who", label: "Who it's for", hint: "Name the customers, users or teams it serves." },
  { key: "why", label: "Why it matters", hint: "Say what problem it solves or what it improves." },
];

/** What / who / why: the three things other teams need from a summary. */
export function Coverage({ coverage }: { coverage: InitiativeAssist["coverage"] }) {
  const missing = COVERAGE.filter((c) => !coverage[c.key]);
  return (
    <div className="text-xs">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-subtle">Summary covers</span>
        {COVERAGE.map((c) => (
          <span
            key={c.key}
            className={cn(
              "inline-flex items-center gap-1",
              coverage[c.key] ? "text-status-shipped" : "text-warning",
            )}
          >
            {coverage[c.key] ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {c.label}
          </span>
        ))}
      </p>
      {missing.length > 0 && (
        <p className="mt-1 text-muted">{missing.map((c) => c.hint).join(" ")}</p>
      )}
    </div>
  );
}

/**
 * "Suggest improvements": AI reviews what's written and proposes edits,
 * field by field. Nothing changes until the author picks a suggestion.
 */
export function Suggestions({
  fields,
  onApply,
  coverage,
  onCoverage,
}: {
  fields: AssistFields;
  onApply: (patch: Partial<AssistFields>) => void;
  coverage: InitiativeAssist["coverage"] | null;
  onCoverage: (c: InitiativeAssist["coverage"]) => void;
}) {
  const [result, setResult] = useState<InitiativeAssist | null>(null);
  const improve = useMutation({
    mutationFn: () =>
      api.assistInitiative({
        mode: "improve",
        title: fields.title,
        summary: fields.summary,
        tags: fields.tags,
      }),
    onSuccess: (r) => {
      setResult(r);
      onCoverage(r.coverage);
    },
  });
  const ready = fields.title.trim().length + fields.summary.trim().length >= 15;

  const same = (a: string, b: string) => a.trim() === b.trim();
  const newTags = result ? result.tags.filter((t) => !fields.tags.includes(t)) : [];
  const titleChange = result && !same(result.title, fields.title) ? result.title : null;
  const summaryChange = result && !same(result.summary, fields.summary) ? result.summary : null;
  const tierChange = result && result.tier !== fields.tier ? result.tier : null;
  const nothingToChange =
    result && !titleChange && !summaryChange && !tierChange && !newTags.length;

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        {coverage ? <Coverage coverage={coverage} /> : <span className="flex-1" />}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => improve.mutate()}
          disabled={!ready || improve.isPending}
          title={
            ready
              ? "AI reviews the title, summary, tags and tier"
              : "Write a title and a short summary first"
          }
        >
          {improve.isPending ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          {improve.isPending ? "Reviewing…" : "Suggest improvements"}
        </Button>
      </div>
      {improve.error && <ErrorNote>{improve.error.message}</ErrorNote>}

      {result && nothingToChange && (
        <p className="flex items-center gap-2 text-xs text-muted" role="status">
          <Check className="h-3.5 w-3.5 text-status-shipped" />
          <span className="flex-1">AI has nothing to change: it reads clearly.</span>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="focus-ring rounded-sm text-subtle hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      )}

      {result && !nothingToChange && (
        <section
          aria-label="AI suggestions"
          className="rounded-lg border border-border bg-elevated/40 p-3 text-sm"
        >
          <div className="space-y-3">
            {titleChange && (
              <SuggestionRow label="Title" onUse={() => onApply({ title: titleChange })}>
                {titleChange}
              </SuggestionRow>
            )}
            {summaryChange && (
              <SuggestionRow label="Summary" onUse={() => onApply({ summary: summaryChange })}>
                {summaryChange}
              </SuggestionRow>
            )}
            {tierChange && (
              <SuggestionRow label="Tier" onUse={() => onApply({ tier: tierChange })}>
                {TIER_LABEL[tierChange]}
              </SuggestionRow>
            )}
            {newTags.length > 0 && (
              <div>
                <p className="text-xs font-medium text-subtle">Tags</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {newTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onApply({ tags: [...fields.tags, t] })}
                      className="focus-ring inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-foreground"
                      aria-label={`Add tag ${t}`}
                    >
                      <Plus className="h-3 w-3" />
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-2">
            <p className="flex-1 text-[11px] text-subtle">
              Suggested by AI from what you wrote. Nothing changes until you pick it.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onApply({
                  ...(titleChange ? { title: titleChange } : {}),
                  ...(summaryChange ? { summary: summaryChange } : {}),
                  ...(tierChange ? { tier: tierChange } : {}),
                  ...(newTags.length ? { tags: [...fields.tags, ...newTags] } : {}),
                });
                setResult(null);
              }}
            >
              Use all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              Dismiss
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function SuggestionRow({
  label,
  children,
  onUse,
}: {
  label: string;
  children: React.ReactNode;
  onUse: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-subtle">{label}</p>
        <p className="mt-0.5 leading-relaxed text-foreground">{children}</p>
      </div>
      <Button size="sm" onClick={onUse} aria-label={`Use suggested ${label.toLowerCase()}`}>
        Use
      </Button>
    </div>
  );
}
