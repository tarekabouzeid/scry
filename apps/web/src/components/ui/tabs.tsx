import { cn } from "@/lib/cn";

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 border-b border-border", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "focus-ring relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
            value === t.id
              ? "border-accent text-foreground"
              : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="rounded-sm bg-elevated px-1 font-mono text-[10px] text-subtle">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
