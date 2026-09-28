import { cn } from "@/lib/cn";

/** Scry's mark — a scrying lens: an orb with an orbiting highlight. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id="scry-lens" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" />
          <stop offset="100%" stopColor="rgb(var(--accent-2))" />
        </linearGradient>
        <radialGradient id="scry-glint" cx="0.35" cy="0.3" r="0.5">
          <stop offset="0%" stopColor="white" stopOpacity="0.85" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#scry-lens)" />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        fill="none"
        stroke="white"
        strokeOpacity="0.9"
        strokeWidth="2"
      />
      <circle cx="16" cy="16" r="3.2" fill="white" />
      <circle cx="16" cy="16" r="11" fill="url(#scry-glint)" opacity="0.35" />
      <path
        d="M4.5 21.5c4-1.8 7.2-6.8 11.5-6.8s7.5 5 11.5 6.8"
        fill="none"
        stroke="white"
        strokeOpacity="0.35"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">Scry</span>
    </div>
  );
}
