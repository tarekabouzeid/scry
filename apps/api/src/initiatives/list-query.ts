import { and, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { initiatives } from "@scry/db";
import type { InitiativeSort } from "@scry/shared";

export type SortDir = "asc" | "desc";

/**
 * One column of a sort order. `flip` means it runs against the chosen
 * direction (status sorts newest-first within each status). `cast` turns
 * the cursor's text value back into the column's type; it comes from this
 * table only, never from a request.
 */
interface SortKey {
  column: AnyPgColumn;
  cast: "timestamptz" | "text" | "initiative_status" | "date";
  flip?: boolean;
  /** Nulls sort last whichever the direction (undated work at the bottom). */
  nullable?: boolean;
}

/**
 * Each order matches an index (see packages/db), with the id as the final
 * tiebreak so every row has one place and keyset paging never skips or
 * repeats one.
 */
export const SORTS: Record<InitiativeSort, { defaultDir: SortDir; keys: SortKey[] }> = {
  updated: { defaultDir: "desc", keys: [{ column: initiatives.updatedAt, cast: "timestamptz" }] },
  title: { defaultDir: "asc", keys: [{ column: initiatives.title, cast: "text" }] },
  // Enum order is the lifecycle order (idea → cancelled), not alphabetical.
  status: {
    defaultDir: "asc",
    keys: [
      { column: initiatives.status, cast: "initiative_status" },
      { column: initiatives.updatedAt, cast: "timestamptz", flip: true },
    ],
  },
  target: {
    defaultDir: "asc",
    keys: [{ column: initiatives.targetDate, cast: "date", nullable: true }],
  },
};

export function resolveSort(sort?: InitiativeSort, dir?: SortDir) {
  const key = sort ?? "updated";
  return { sort: key, dir: dir ?? SORTS[key].defaultDir };
}

interface ResolvedKey {
  expr: SQL | AnyPgColumn;
  cast: string;
  desc: boolean;
  nullable: boolean;
}

function resolvedKeys(sort: InitiativeSort, dir: SortDir): ResolvedKey[] {
  const keys = SORTS[sort].keys.map((k) => ({
    expr: k.column,
    cast: k.cast,
    desc: (dir === "desc") !== !!k.flip,
    nullable: !!k.nullable,
  }));
  // The id breaks ties in the direction of the last key.
  return [
    ...keys,
    { expr: initiatives.id, cast: "uuid", desc: keys.at(-1)!.desc, nullable: false },
  ];
}

export function orderByFor(sort: InitiativeSort, dir: SortDir): SQL[] {
  return resolvedKeys(sort, dir).map(
    (k) =>
      sql`${k.expr} ${sql.raw(k.desc ? "desc" : "asc")}${sql.raw(k.nullable ? " nulls last" : "")}`,
  );
}

/** The sort columns as text, selected alongside each row to build the next cursor. */
export function sortValueColumns(sort: InitiativeSort): Record<string, SQL<string | null>> {
  return Object.fromEntries(
    SORTS[sort].keys.map((k, i) => [`_k${i}`, sql<string | null>`${k.column}::text`]),
  );
}

/** Rows strictly after the cursor's row in this order. */
export function keysetAfter(sort: InitiativeSort, dir: SortDir, cursor: Cursor): SQL {
  const keys = resolvedKeys(sort, dir);
  const values = [...cursor.values, cursor.id];
  const value = (i: number) => sql`${values[i]}::${sql.raw(keys[i]!.cast)}`;

  // Same direction throughout and no nulls: one row comparison, which
  // Postgres answers straight from the matching index.
  if (keys.every((k) => k.desc === keys[0]!.desc && !k.nullable)) {
    const cols = sql.join(
      keys.map((k) => sql`${k.expr}`),
      sql`, `,
    );
    const vals = sql.join(
      keys.map((_, i) => value(i)),
      sql`, `,
    );
    return sql`(${cols}) ${sql.raw(keys[0]!.desc ? "<" : ">")} (${vals})`;
  }

  // Otherwise spell out the lexicographic comparison: past the cursor on the
  // first key, or equal on it and past it on the next, and so on.
  const equal = (i: number) =>
    values[i] === null ? sql`${keys[i]!.expr} is null` : sql`${keys[i]!.expr} = ${value(i)}`;
  const after = (i: number): SQL | undefined => {
    const k = keys[i]!;
    // Nulls come last, so nothing but another null follows a null.
    if (values[i] === null) return undefined;
    const past = sql`${k.expr} ${sql.raw(k.desc ? "<" : ">")} ${value(i)}`;
    return k.nullable ? sql`(${past} or ${k.expr} is null)` : past;
  };
  const branches = keys
    .map((_, i) => {
      const past = after(i);
      if (!past) return undefined;
      return i === 0 ? past : and(...keys.slice(0, i).map((__, j) => equal(j)), past);
    })
    .filter((b): b is SQL => b !== undefined);
  return branches.length ? sql`(${or(...branches)})` : sql`false`;
}

// --- Cursors -------------------------------------------------------------

/**
 * Where the previous page ended: the last row's sort values (as text) and
 * id. It names its sort, so a cursor from one order can't be replayed
 * against another (the values wouldn't even cast).
 */
export interface Cursor {
  sort: InitiativeSort;
  dir: SortDir;
  values: (string | null)[];
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify([cursor.sort, cursor.dir, cursor.values, cursor.id]),
    "utf8",
  ).toString("base64url");
}

/** The cursor, or null when it's malformed or was made for another order. */
export function decodeCursor(raw: string, sort: InitiativeSort, dir: SortDir): Cursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return null;
  const [s, d, values, id] = parsed as unknown[];
  if (s !== sort || d !== dir) return null;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (
    !Array.isArray(values) ||
    values.length !== SORTS[sort].keys.length ||
    !values.every((v) => v === null || (typeof v === "string" && v.length <= 1000))
  ) {
    return null;
  }
  // Only a nullable key can hold null.
  if (values.some((v, i) => v === null && !SORTS[sort].keys[i]!.nullable)) return null;
  return { sort, dir, values: values as (string | null)[], id };
}

// --- Filters -------------------------------------------------------------

/** Escape LIKE wildcards so a search for "100%" or "foo_bar" matches literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Search words (at most 8); every one must appear in the title or summary. */
export function searchWords(search: string | undefined): string[] {
  return (search ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

export interface InitiativeFilters {
  teamId?: string;
  /** Other teams' work only (relationships only connect different teams). */
  notTeamId?: string;
  /** Leave out merged duplicates. */
  unmerged?: boolean;
  status?: string;
  tier?: string;
  search?: string;
  tag?: string;
  from?: string;
  to?: string;
}

export function filterConditions(f: InitiativeFilters): SQL[] {
  const conditions: (SQL | undefined)[] = [
    f.teamId ? sql`${initiatives.teamId} = ${f.teamId}` : undefined,
    f.status ? sql`${initiatives.status} = ${f.status}` : undefined,
    f.tier ? sql`${initiatives.tier} = ${f.tier}` : undefined,
    f.notTeamId ? sql`${initiatives.teamId} <> ${f.notTeamId}` : undefined,
    f.unmerged ? sql`${initiatives.mergedIntoId} is null` : undefined,
    // Each word in the title, the summary or as a whole tag (the tag test is
    // containment, so the tags GIN index answers it alongside the trigrams).
    ...searchWords(f.search).map((word) =>
      or(
        ilike(initiatives.title, `%${escapeLike(word)}%`),
        ilike(initiatives.summary, `%${escapeLike(word)}%`),
        sql`${initiatives.tags} @> array[${word.toLowerCase()}]::text[]`,
      ),
    ),
    // Containment, so the GIN index on tags can answer it. Tags are stored
    // normalised (trimmed, lower case).
    f.tag?.trim()
      ? sql`${initiatives.tags} @> array[${f.tag.trim().toLowerCase()}]::text[]`
      : undefined,
    // The timeline's window: anything dated whose span touches it. Work with
    // only a start runs on open-ended, so it counts once it has started.
    f.to
      ? sql`coalesce(${initiatives.startDate}, ${initiatives.targetDate}) <= ${f.to}::date`
      : undefined,
    f.from
      ? sql`(${initiatives.targetDate} >= ${f.from}::date or (${initiatives.targetDate} is null and ${initiatives.startDate} is not null))`
      : undefined,
  ];
  return conditions.filter((c): c is SQL => c !== undefined);
}
