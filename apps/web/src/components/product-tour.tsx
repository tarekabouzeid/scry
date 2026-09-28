"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";

export interface TourStep {
  /**
   * `data-tour` value(s) of the element to point at, in order of preference
   * (the first visible one wins, e.g. a sidebar item, else the phone menu
   * button). None, or nothing visible, centres the card.
   */
  target?: string | string[];
  title: string;
  body: ReactNode;
}

const PAD = 6; // spotlight padding around the target
const GAP = 14; // space between target and card
const CARD_W = 340;

/** The first visible element for a tour target (some exist twice, e.g. desktop and mobile). */
function findTarget(target: string | string[] | undefined): HTMLElement | null {
  for (const name of [target ?? []].flat()) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function placeCard(rect: DOMRect | null, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 32);
  const clampX = (x: number) => Math.min(Math.max(16, x), vw - w - 16);
  const clampY = (y: number) => Math.min(Math.max(16, y), vh - cardH - 16);
  if (!rect) return { left: (vw - w) / 2, top: Math.max(16, (vh - cardH) / 2), width: w };
  if (rect.right + GAP + w <= vw - 16)
    return { left: rect.right + GAP, top: clampY(rect.top), width: w };
  if (rect.bottom + GAP + cardH <= vh - 16)
    return { left: clampX(rect.left), top: rect.bottom + GAP, width: w };
  if (rect.left - GAP - w >= 16)
    return { left: rect.left - GAP - w, top: clampY(rect.top), width: w };
  return { left: clampX(rect.left), top: clampY(rect.top - GAP - cardH), width: w };
}

/**
 * A short guided tour: dims the page, spotlights one part of the UI at a
 * time and explains it in a sentence or two. Keyboard: ←/→ to move, Esc to
 * leave. The page underneath isn't clickable while it runs.
 */
export function ProductTour({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[];
  open: boolean;
  /** Called when the tour is finished or skipped. */
  onClose: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const measure = useCallback(() => {
    const el = findTarget(step?.target);
    setRect(el ? el.getBoundingClientRect() : null);
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step]);

  // Bring the target into view, then measure (again once layout settles).
  useLayoutEffect(() => {
    if (!open || !step) return;
    findTarget(step.target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const raf = requestAnimationFrame(measure);
    const late = setTimeout(measure, 250);
    nextRef.current?.focus();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(late);
    };
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => requestAnimationFrame(measure);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
      else if (e.key === "ArrowRight") {
        if (last) onClose(true);
        else setIndex((i) => i + 1);
      } else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else return;
      // Keep app shortcuts (Esc closes the details panel, etc.) out of it.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, last, onClose]);

  if (!open || !step || typeof document === "undefined") return null;
  const pos = placeCard(rect, cardH);

  return createPortal(
    <div className="fixed inset-0 z-70" data-product-tour>
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent transition-all duration-200 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 4px rgb(var(--accent) / 0.25), 0 0 0 9999px rgb(0 0 0 / 0.7)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/70 animate-fade-in" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed rounded-xl border border-border bg-surface p-4 shadow-pop transition-[top,left] duration-200 ease-out animate-fade-in"
        style={{ top: pos.top, left: pos.left, width: pos.width }}
      >
        <div className="flex items-start gap-3">
          <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-subtle">
            {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close tour"
            className="focus-ring -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-base font-semibold text-foreground">
          {step.title}
        </h2>
        <div id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted">
          {step.body}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-4 bg-accent" : "w-1.5 bg-border-strong",
                )}
              />
            ))}
          </div>
          {index === 0 ? (
            <Button size="sm" variant="ghost" onClick={() => onClose(false)}>
              Skip
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setIndex((i) => i - 1)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
          <Button
            ref={nextRef}
            size="sm"
            variant="primary"
            onClick={() => (last ? onClose(true) : setIndex((i) => i + 1))}
          >
            {last ? "Done" : index === 0 ? "Show me" : "Next"}
            {!last && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
