"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "scry-theme";

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePreference) {
  const light =
    pref === "light" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

/**
 * Inline <head> script: applies the stored theme before first paint, so a
 * light-mode user never sees a dark flash. Kept tiny and dependency-free.
 */
export const THEME_BOOTSTRAP = `(function(){try{var p=localStorage.getItem("${KEY}");var l=p==="light"||(p!=="dark"&&matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.dataset.theme=l?"light":"dark"}catch(e){}})()`;

export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    setPref(read());
  }, []);

  // Follow the OS while on "system".
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const set = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode etc. — the choice just won't persist.
    }
    setPref(next);
    apply(next);
  }, []);

  return [pref, set];
}
