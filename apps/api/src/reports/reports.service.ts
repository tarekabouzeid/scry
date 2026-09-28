import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import type { Db } from "@scry/db";
import type { PortfolioBrief } from "@scry/shared";
import { DB } from "../db/db.module";
import { BriefCache, briefCacheKey } from "./brief-cache";
import { computeBrief } from "./brief";
import { SqlBriefSource } from "./sql-brief-source";

/**
 * The portfolio brief, computed section by section in SQL (see brief.ts
 * for the assembly and SqlBriefSource for the queries) and cached briefly.
 */
@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly source: SqlBriefSource;
  private readonly redis: Redis | null;
  private readonly cache: BriefCache;

  constructor(
    @Inject(DB) private readonly db: Db,
    config: ConfigService,
  ) {
    this.source = new SqlBriefSource(db);
    const url = config.get<string>("REDIS_URL");
    // Its own connection that gives up fast: a cache must never hang a request.
    this.redis = url
      ? new Redis(url, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 2_000,
        })
      : null;
    this.redis?.on("error", () => undefined);
    this.cache = new BriefCache(this.redis);
  }

  async brief(opts: { days: number | null; orgUnit: string | null }): Promise<PortfolioBrief> {
    const key = briefCacheKey(opts.days, opts.orgUnit);
    const fingerprint = await this.fingerprint();
    const cached = await this.cache.get(key, fingerprint);
    if (cached) return cached;
    const brief = await computeBrief(this.source, opts, Date.now());
    await this.cache.set(key, fingerprint, brief);
    return brief;
  }

  /**
   * Changes whenever something the brief shows changes: every initiative
   * write bumps updated_at, and the counts catch deleted rows. The
   * initiatives count is the dear part (~50 ms at a million rows); the rest
   * are index lookups and small tables.
   */
  private async fingerprint(): Promise<string> {
    const [row] = await this.db.execute<{ v: string }>(sql`
      select concat_ws('|',
        (select count(*) || '@' || coalesce(max(updated_at)::text, '') from initiatives),
        (select count(*) || '@' || coalesce(max(updated_at)::text, '') from initiative_overlaps),
        (select count(*) || '@' || coalesce(max(confirmed_at)::text, '') from initiative_signals),
        (select count(*) || '@' || coalesce(max(created_at)::text, '') from edges),
        (select count(*) || '@' || coalesce(max(updated_at)::text, '') from teams),
        (select max(created_at) from activity where kind = 'status_changed')
      ) as v`);
    return row?.v ?? "";
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
