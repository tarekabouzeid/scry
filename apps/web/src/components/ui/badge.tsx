import type { ReactNode } from "react";
import type { InitiativeStatus, InitiativeTier } from "@scry/shared";
import { Target, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { STATUS_META, TIER_LABEL } from "@/lib/format";

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status as InitiativeStatus];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        meta?.badge ?? "bg-elevated text-muted ring-border",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta?.dot ?? "bg-muted")} />
      {meta?.label ?? status}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const strategic = tier === "strategic";
  const Icon = strategic ? Target : Zap;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs",
        strategic ? "bg-warning/10 text-warning" : "bg-elevated text-muted",
      )}
    >
      <Icon className="h-3 w-3" />
      {TIER_LABEL[tier as InitiativeTier] ?? tier}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
      #{children}
    </span>
  );
}
