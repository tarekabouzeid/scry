export const EMBEDDING_QUEUE = "embedding";

/** One initiative (after an edit), or a batch of them (backfills and re-indexing). */
export interface GenerateEmbeddingJob {
  initiativeId?: string;
  initiativeIds?: string[];
}

/** Worker concurrency defaults; override with EMBEDDING_CONCURRENCY / TLDR_CONCURRENCY. */
export const DEFAULT_EMBEDDING_CONCURRENCY = 8;
export const DEFAULT_TLDR_CONCURRENCY = 4;
/** TL;DRs started per second at most, across the worker: background polish mustn't flood the model. */
export const TLDR_PER_SECOND = 5;

/** A positive whole number from the environment, or the default. */
export function concurrencyFrom(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Split into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const TLDR_QUEUE = "tldr";

export interface GenerateTldrJob {
  initiativeId: string;
}
