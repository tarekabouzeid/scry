"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace";

/**
 * Shown where an AI feature would be when no model is connected: admins get
 * a way to fix it, everyone else knows who to ask.
 */
export function AiSetupNotice({
  feature,
  variant = "card",
  className,
}: {
  /** What's unavailable, e.g. "Ask Scry". */
  feature: string;
  variant?: "card" | "bar";
  className?: string;
}) {
  const { user, navigate } = useWorkspace();
  const isAdmin = user.role === "admin";
  const action = isAdmin ? (
    <Button
      size="sm"
      variant={variant === "bar" ? "secondary" : "primary"}
      onClick={() => navigate({ view: "admin", tab: "ai", i: null })}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Set up AI
    </Button>
  ) : null;

  if (variant === "bar") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/25 bg-warning/[0.07] px-4 py-2 text-sm sm:px-6",
          className,
        )}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-muted">
          <span className="font-medium text-foreground">No AI model connected.</span> {feature}{" "}
          {isAdmin ? "turn on once you connect one." : "are off until an admin connects one."}
        </p>
        {action}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-warning/30 bg-warning/6 px-5 py-4 text-center",
        className,
      )}
    >
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{feature} needs an AI model.</span>{" "}
        {isAdmin
          ? "Connect one — a LiteLLM gateway, OpenAI, or the bundled demo LLM — in Admin → AI & models."
          : "An admin can connect one in Admin → AI & models."}
      </p>
      {action}
    </div>
  );
}
