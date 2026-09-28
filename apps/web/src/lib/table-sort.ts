import type { InitiativeSort } from "@scry/shared";

export type SortDir = "asc" | "desc";

/** Each order's natural direction: newest first, A–Z, lifecycle, soonest. */
export const DEFAULT_DIR: Record<InitiativeSort, SortDir> = {
  updated: "desc",
  title: "asc",
  status: "asc",
  target: "asc",
};

function isSort(value: string): value is InitiativeSort {
  return value in DEFAULT_DIR;
}

/** The table's order from the URL; anything unknown falls back to the default. */
export function parseTableSort(sort: string, dir: string): { sort: InitiativeSort; dir: SortDir } {
  const key = isSort(sort) ? sort : "updated";
  return { sort: key, dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_DIR[key] };
}

/**
 * What clicking a column header does: a new column starts in its natural
 * direction, the current one flips. Returns URL values, empty for defaults,
 * so the plain view keeps a plain link.
 */
export function nextTableSort(
  current: { sort: InitiativeSort; dir: SortDir },
  clicked: InitiativeSort,
): { sort: string; dir: string } {
  const dir: SortDir =
    current.sort === clicked ? (current.dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[clicked];
  return {
    sort: clicked === "updated" ? "" : clicked,
    dir: dir === DEFAULT_DIR[clicked] ? "" : dir,
  };
}
