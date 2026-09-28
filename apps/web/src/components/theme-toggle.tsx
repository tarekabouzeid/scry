"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const ICON = { system: Monitor, light: Sun, dark: Moon };
const LABEL = { system: "System theme", light: "Light theme", dark: "Dark theme" };

/** Cycles System → Light → Dark. */
export function ThemeToggle() {
  const [pref, setPref] = useTheme();
  const Icon = ICON[pref];
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      title={`${LABEL[pref]} — click to change`}
      aria-label={`${LABEL[pref]} — click to change`}
      className="focus-ring flex h-8 w-8 items-center justify-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
