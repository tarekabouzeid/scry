"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Click-to-toggle popover anchored to its trigger. Rendered in a portal with
 * fixed positioning so it's never clipped by a scroll container or painted
 * under a later sibling's stacking context (animations, backdrop blur).
 * Flips above the trigger when there isn't room below; closes on outside
 * click, Escape, scroll or resize.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const place = () => {
      const a = anchorRef.current!.getBoundingClientRect();
      const height = panelRef.current?.offsetHeight ?? 0;
      const gap = 8;
      const below = a.bottom + gap;
      const fitsBelow = below + height <= window.innerHeight - gap;
      const top = fitsBelow || a.top - gap - height < gap ? below : a.top - gap - height;
      setPos(
        align === "end"
          ? { top, right: Math.max(gap, window.innerWidth - a.right) }
          : { top, left: Math.max(gap, a.left) },
      );
    };
    place();
    // Measure again once the panel has rendered and has a real height.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={anchorRef} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left,
              right: pos?.right,
              visibility: pos ? "visible" : "hidden",
            }}
            className={cn(
              "z-55 rounded-xl border border-border bg-surface shadow-pop animate-fade-in",
              className,
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  icon,
  tone,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        tone === "danger"
          ? "text-status-blocked hover:bg-status-blocked/10"
          : "text-foreground hover:bg-elevated",
      )}
    >
      {icon && <span className="flex h-4 w-4 items-center justify-center text-subtle">{icon}</span>}
      {children}
    </button>
  );
}
