"use client";

/**
 * Hand a question to Ask Scry from elsewhere (⌘K, the New initiative
 * dialog). The chat view picks it up when it mounts, or when it's already
 * open, through the event.
 */
const EVENT = "scry:ask";
let pending: string | null = null;

export function queueQuestion(question: string) {
  pending = question.trim() || null;
  window.dispatchEvent(new Event(EVENT));
}

export function takeQuestion(): string | null {
  const q = pending;
  pending = null;
  return q;
}

export function onQuestion(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
