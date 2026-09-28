/**
 * Dotted paths whose values differ between two plain JSON objects — e.g.
 * ["connection.auth.mode", "models.embedding.model"]. Used to say what an
 * admin changed without storing whole config blobs.
 */
export function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => changedPaths(before[k], after[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || "(root)"];
}
