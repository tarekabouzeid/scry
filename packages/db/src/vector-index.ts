import { sql, type SQL } from "drizzle-orm";
import type postgres from "postgres";
import { initiatives } from "./schema";

// The one index the app manages itself rather than a migration: the
// embedding column has no fixed size (admins pick the model), and an HNSW
// index needs one. So there's a partial index per configured size, built on
// the vector cast to halfvec (half the memory, and HNSW over halfvec goes to
// 4000 dimensions where plain vector stops at 2000). Queries must repeat the
// same cast and predicate to use it: build them with sameVectorSize() and
// halfvecDistance() below.

/** HNSW over halfvec supports up to this many dimensions. */
export const MAX_INDEXED_DIMENSIONS = 4000;

const INDEX_PREFIX = "initiatives_embedding_hnsw_";

// Any stable number works: it only has to be the same in every replica.
const LOCK_KEY = 7_302_418_551;

/**
 * Memory for the index build, as Postgres spells it ("512MB", "2GB"). The
 * server default (64 MB) makes a million-row build take hours; with the
 * graph in memory it takes minutes. Only this connection gets it, and only
 * for the build. Interpolated into SET, so it's checked first.
 */
export function assertBuildMemory(memory: string): string {
  if (!/^\d{1,6}(kB|MB|GB)$/.test(memory)) {
    throw new Error(`Invalid index build memory: ${memory} (use e.g. 512MB or 2GB)`);
  }
  return memory;
}

export function vectorIndexName(dims: number): string {
  return `${INDEX_PREFIX}${dims}`;
}

export function assertDims(dims: number): number {
  if (!Number.isInteger(dims) || dims < 1 || dims > 16_000) {
    throw new Error(`Invalid embedding size: ${dims}`);
  }
  return dims;
}

/** The index definition for one embedding size. `dims` is interpolated, so it's checked first. */
export function createVectorIndexSql(dims: number): string {
  const n = assertDims(dims);
  return (
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${vectorIndexName(n)} ON initiatives ` +
    `USING hnsw ((embedding::halfvec(${n})) halfvec_cosine_ops) ` +
    `WHERE vector_dims(embedding) = ${n}`
  );
}

/** Index names (of ours) that should go: other sizes, or this size's index if a build failed. */
export function indexesToDrop(
  existing: Array<{ name: string; valid: boolean }>,
  dims: number,
): string[] {
  const keep = vectorIndexName(dims);
  return existing
    .filter((i) => i.name.startsWith(INDEX_PREFIX))
    .filter((i) => i.name !== keep || !i.valid)
    .map((i) => i.name);
}

/**
 * Make sure the HNSW index for `dims` exists (and none for other sizes).
 * Safe to call from every replica on every start: one takes an advisory
 * lock and does the work, the others skip. Builds CONCURRENTLY, so writes
 * carry on meanwhile; on a big table it takes minutes, so don't await it
 * on a request path. Returns what it did.
 */
export async function ensureVectorIndex(
  sql: postgres.Sql,
  dims: number,
  buildMemory = "1GB",
): Promise<"created" | "exists" | "busy" | "skipped"> {
  assertDims(dims);
  assertBuildMemory(buildMemory);
  const conn = await sql.reserve();
  try {
    const [lock] = await conn`select pg_try_advisory_lock(${LOCK_KEY}) as ok`;
    if (!lock?.ok) return "busy";
    try {
      const existing = await conn<Array<{ name: string; valid: boolean }>>`
        select c.relname as name, i.indisvalid as valid
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        where i.indrelid = 'initiatives'::regclass and c.relname like ${INDEX_PREFIX + "%"}`;
      for (const name of indexesToDrop(existing, dims)) {
        await conn.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
      }
      if (dims > MAX_INDEXED_DIMENSIONS) return "skipped";
      const had = existing.some((i) => i.name === vectorIndexName(dims) && i.valid);
      if (had) return "exists";
      await conn.unsafe(`SET maintenance_work_mem = '${buildMemory}'`);
      try {
        await conn.unsafe(createVectorIndexSql(dims));
      } finally {
        // The connection goes back to the pool; don't leave the setting on it.
        await conn`RESET maintenance_work_mem`;
      }
      return "created";
    } finally {
      await conn`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    conn.release();
  }
}

/**
 * `vector_dims(embedding) = N` with N as a literal: the planner only uses a
 * partial index when it can prove the predicate, which a bound parameter in a
 * reused (generic) plan doesn't allow.
 */
export function sameVectorSize(dims: number): SQL {
  return sql`vector_dims(${initiatives.embedding}) = ${sql.raw(String(assertDims(dims)))}`;
}

/** Cosine distance in the indexed form; order by this (ascending) to use the HNSW index. */
export function halfvecDistance(query: number[]): SQL<number> {
  const n = sql.raw(String(assertDims(query.length)));
  return sql<number>`(${initiatives.embedding}::halfvec(${n}) <=> ${JSON.stringify(query)}::halfvec(${n}))`;
}
