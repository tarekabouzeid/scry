"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-browser UI preferences (density, panel width, saved views…). They are
 * conveniences, not data: storage can be unavailable (private mode, blocked
 * site data), in which case the default is used and changes last for the tab.
 */
const EVENT = "scry:prefchange";
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept in memory only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Parsed values are cached per raw string so consumers get stable references.
const parsed = new Map<string, { raw: string | null; value: unknown }>();

export function usePref<T>(key: string, fallback: T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  let value: T = fallback;
  if (raw !== null) {
    const hit = parsed.get(key);
    if (hit && hit.raw === raw) value = hit.value as T;
    else {
      try {
        value = JSON.parse(raw) as T;
        parsed.set(key, { raw, value });
      } catch {
        value = fallback;
      }
    }
  }
  const set = useCallback((next: T) => writeRaw(key, JSON.stringify(next)), [key]);
  return [value, set];
}
