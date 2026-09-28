import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  trailing?: ReactNode;
}

export function Input({ className, icon, trailing, ...props }: InputProps) {
  return (
    <div
      className={cn(
        "group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong",
        className,
      )}
    >
      {icon && (
        <span className="flex shrink-0 text-subtle transition-colors group-focus-within:text-accent">
          {icon}
        </span>
      )}
      <input
        className="h-full w-full min-w-0 bg-transparent text-foreground placeholder:text-subtle focus:outline-hidden"
        {...props}
      />
      {trailing}
    </div>
  );
}
