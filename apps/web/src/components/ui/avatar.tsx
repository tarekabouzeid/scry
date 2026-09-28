import { cn } from "@/lib/cn";
import { gradientFor, initials } from "@/lib/format";

export function Avatar({
  id,
  name,
  size = "md",
  square = false,
  className,
}: {
  id: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  square?: boolean;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center bg-linear-to-br font-semibold text-white ring-1 ring-inset ring-white/10",
        gradientFor(id),
        square ? "rounded-md" : "rounded-full",
        size === "xs" && "h-4 w-4 text-[8px]",
        size === "sm" && "h-5 w-5 text-[9px]",
        size === "md" && "h-8 w-8 text-xs",
        size === "lg" && "h-10 w-10 text-sm",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
