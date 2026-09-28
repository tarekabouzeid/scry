import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: ReactNode;
  /**
   * A filter control: muted while "all", highlighted once narrowed, so it's
   * obvious which filters are on. Form fields leave this off and always look
   * like ordinary inputs.
   */
  filter?: boolean;
}

export function Select({ className, icon, value, filter = false, ...props }: SelectProps) {
  const set = value !== undefined && value !== "";
  const active = filter && set;
  return (
    <div
      className={cn(
        "relative flex h-9 items-center rounded-lg border bg-surface text-sm transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20",
        active
          ? "border-accent/40 text-foreground"
          : cn(
              "border-border hover:border-border-strong",
              filter && !set ? "text-muted" : "text-foreground",
            ),
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            "pointer-events-none absolute left-2.5 flex",
            active ? "text-accent" : "text-subtle",
          )}
        >
          {icon}
        </span>
      )}
      <select
        value={value}
        className={cn(
          "h-full w-full cursor-pointer appearance-none bg-transparent pr-8 focus:outline-hidden [&>option]:bg-elevated [&>option]:text-foreground",
          icon ? "pl-8" : "pl-3",
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-subtle" />
    </div>
  );
}
