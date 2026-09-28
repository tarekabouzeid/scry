import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-sm",
        size === "icon" && "h-8 w-8 text-sm",
        variant === "primary" &&
          "bg-accent-gradient text-white shadow-glow hover:brightness-110 [text-shadow:0_1px_0_rgb(0_0_0/0.15)]",
        variant === "secondary" &&
          "border border-border bg-elevated text-foreground hover:border-border-strong hover:bg-border/60",
        variant === "ghost" && "text-muted hover:bg-elevated hover:text-foreground",
        variant === "danger" &&
          "bg-status-blocked/10 text-status-blocked ring-1 ring-inset ring-status-blocked/30 hover:bg-status-blocked/20",
        className,
      )}
      {...props}
    />
  );
}
