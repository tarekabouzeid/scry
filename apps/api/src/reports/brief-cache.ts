import { Logger } from "@nestjs/common";
import type { PortfolioBrief } from "@scry/shared";

/** The few Redis calls the cache makes, so tests can pass a stand-in. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

export const BRIEF_CACHE_SECONDS = 300;

export function briefCacheKey(days: number | null, orgUnit: string | null): string {
  return `scry:brief:v1:${days ?? "all"}:${orgUnit ?? ""}`;
}

/**
 * The brief, cached in Redis per (period, org unit) for five minutes, so a
 * leadership meeting opening it at once costs one computation. Each entry
 * carries a fingerprint of the data it was computed from (latest updates
 * and row counts, see ReportsService); a write in between makes it miss
 * rather than show a merge that already happened as still open.
 *
 * Fails open: without Redis the brief is simply computed every time.
 */
export class BriefCache {
  private readonly logger = new Logger(BriefCache.name);
  private lastWarning = 0;

  constructor(private readonly store: CacheStore | null) {}

  async get(key: string, fingerprint: string): Promise<PortfolioBrief | null> {
    if (!this.store) return null;
    try {
      const hit = await this.store.get(key);
      if (!hit) return null;
      const entry = JSON.parse(hit) as { fingerprint: string; brief: PortfolioBrief };
      return entry.fingerprint === fingerprint ? entry.brief : null;
    } catch (err) {
      this.warn(err);
      return null;
    }
  }

  async set(key: string, fingerprint: string, brief: PortfolioBrief): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.set(key, JSON.stringify({ fingerprint, brief }), "EX", BRIEF_CACHE_SECONDS);
    } catch (err) {
      this.warn(err);
    }
  }

  private warn(err: unknown) {
    if (Date.now() - this.lastWarning < 60_000) return;
    this.lastWarning = Date.now();
    this.logger.warn(`Brief cache skipped, Redis unavailable: ${(err as Error).message}`);
  }
}
