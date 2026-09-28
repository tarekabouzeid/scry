import { sql } from "drizzle-orm";
import type { Db } from "@scry/db";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** hnsw.ef_search for a query that wants `limit` rows: pgvector's default 40, or twice the page. */
export function efSearchFor(limit: number): number {
  return Math.min(Math.max(40, Math.trunc(limit) * 2), 1000);
}

/**
 * Run a nearest-neighbour query (ordered by halfvecDistance, see @scry/db's
 * vector-index.ts) with the HNSW settings it needs. Iterative scans keep
 * going past the first ef_search candidates when a filter (a team, other
 * teams only, a score threshold) throws many away; relaxed order is fine
 * because callers re-sort by exact distance.
 */
export function withVectorScan<T>(db: Db, limit: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    await tx.execute(sql.raw(`set local hnsw.ef_search = ${efSearchFor(limit)}`));
    return fn(tx);
  });
}
