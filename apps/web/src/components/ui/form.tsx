"use client";

import { useId, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-status-blocked">{error}</span>
      ) : (
        hint && <span className="text-xs text-subtle">{hint}</span>
      )}
    </label>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-[84px] w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground transition-colors placeholder:text-subtle hover:border-border-strong focus:border-accent/60 focus:outline-hidden focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    />
  );
}

/** A tag as Scry stores it: trimmed, lower case, no leading #. */
export const normalizeTag = (raw: string) => raw.trim().replace(/^#/, "").toLowerCase();

/**
 * Existing tags that match what's typed (prefix matches first), most used
 * first, leaving out ones already chosen. Shared by every tag picker so they
 * behave the same.
 */
function matchTags(suggestions: string[], draft: string, exclude: string[]) {
  const q = normalizeTag(draft);
  const pool = suggestions.filter((t) => !exclude.includes(t));
  if (!q) return pool.slice(0, 8);
  const starts = pool.filter((t) => t.startsWith(q));
  const contains = pool.filter((t) => !t.startsWith(q) && t.includes(q));
  return [...starts, ...contains].slice(0, 8);
}

function TagOptions({
  id,
  options,
  active,
  onPick,
  footer,
}: {
  id: string;
  options: string[];
  active: number;
  onPick: (tag: string) => void;
  footer?: ReactNode;
}) {
  if (!options.length && !footer) return null;
  return (
    <ul
      id={id}
      role="listbox"
      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-elevated p-1 shadow-pop"
    >
      {options.map((t, i) => (
        <li
          key={t}
          role="option"
          aria-selected={i === active}
          // Keep focus in the input so the pick lands before blur.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
          className={cn(
            "cursor-pointer rounded-md px-2 py-1 font-mono text-[12px] text-foreground",
            i === active ? "bg-accent/15" : "hover:bg-surface",
          )}
        >
          #{t}
        </li>
      ))}
      {footer && <li className="px-2 py-1 text-xs text-subtle">{footer}</li>}
    </ul>
  );
}

/** Keyboard handling shared by the tag pickers: ↑/↓ to move, Enter to pick, Esc to close. */
function useTagKeys(options: string[], onPick: (tag: string) => void, onEnterFree: () => void) {
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && options[active]) onPick(options[active]!);
      else onEnterFree();
      setActive(-1);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };
  return { active, setActive, open, setOpen, onKeyDown };
}

/**
 * Chip-style tag editor with suggestions from the tags already in use, so
 * people reuse the organisation's vocabulary. Enter or comma adds; with
 * `allowNew` off, only existing tags can be chosen.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  allowNew = true,
  placeholder = "Add a tag…",
  max = 20,
  label,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  allowNew?: boolean;
  placeholder?: string;
  max?: number;
  label?: string;
}) {
  const [draft, setDraft] = useState("");
  const options = matchTags(suggestions, draft, value);
  const listId = useId();
  const add = (raw: string) => {
    const tags = raw
      .split(",")
      .map(normalizeTag)
      .filter(Boolean)
      .filter((t) => allowNew || suggestions.includes(t));
    const next = [...new Set([...value, ...tags])].slice(0, max);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const keys = useTagKeys(options, add, () => draft.trim() && add(draft));
  const unknown = !allowNew && !!normalizeTag(draft) && !suggestions.includes(normalizeTag(draft));
  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted"
          >
            #{tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-subtle hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={keys.open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={draft}
          onChange={(e) => {
            keys.setOpen(true);
            keys.setActive(-1);
            if (e.target.value.includes(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onFocus={() => keys.setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
            else keys.onKeyDown(e);
          }}
          onBlur={() => {
            keys.setOpen(false);
            if (draft.trim()) add(draft);
          }}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-hidden"
        />
      </div>
      {keys.open && (
        <TagOptions
          id={listId}
          options={options}
          active={keys.active}
          onPick={add}
          footer={unknown ? `No initiative is tagged #${normalizeTag(draft)}` : undefined}
        />
      )}
    </div>
  );
}

/**
 * Pick one existing tag (e.g. to follow it): the same suggestions as the tag
 * editor, but only tags some initiative already uses.
 */
export function TagSearch({
  value,
  onChange,
  onPick,
  suggestions,
  placeholder = "Search tags…",
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called with an existing tag, from the list or by typing it exactly. */
  onPick: (tag: string) => void;
  suggestions: string[];
  placeholder?: string;
  label?: string;
}) {
  const options = matchTags(suggestions, value, []);
  const listId = useId();
  const pick = (tag: string) => {
    onPick(tag);
    onChange("");
  };
  const keys = useTagKeys(options, pick, () => {
    const exact = normalizeTag(value);
    if (suggestions.includes(exact)) pick(exact);
  });
  const unknown = !!normalizeTag(value) && options.length === 0;
  return (
    <div className="relative flex-1">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong">
        <span className="font-mono text-subtle">#</span>
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={keys.open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          value={value}
          onChange={(e) => {
            keys.setOpen(true);
            keys.setActive(-1);
            onChange(e.target.value);
          }}
          onFocus={() => keys.setOpen(true)}
          onBlur={() => keys.setOpen(false)}
          onKeyDown={keys.onKeyDown}
          placeholder={placeholder}
          className="h-full w-full min-w-0 bg-transparent text-foreground placeholder:text-subtle focus:outline-hidden"
        />
      </div>
      {keys.open && (
        <TagOptions
          id={listId}
          options={options}
          active={keys.active}
          onPick={pick}
          footer={unknown ? `No initiative is tagged #${normalizeTag(value)}` : undefined}
        />
      )}
    </div>
  );
}
