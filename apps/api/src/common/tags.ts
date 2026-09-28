/** Tags are matched by subscriptions and filters — keep them trimmed, lowercase, unique. */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
