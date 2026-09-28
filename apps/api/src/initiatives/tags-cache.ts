import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

const KEY = "scry:tags-in-use";
const TTL_SECONDS = 60;

/**
 * The tag vocabulary for suggestions, cached in Redis for a minute: counting
 * every tag means unnesting the whole table, and it's asked for on every
 * form open. Fails open (a miss) when Redis is unreachable, on its own
 * connection that gives up fast rather than queueing like the job queue's.
 */
@Injectable()
export class TagsCache implements OnModuleDestroy {
  private readonly logger = new Logger(TagsCache.name);
  private readonly redis?: Redis;
  private lastWarning = 0;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL");
    if (!url) return;
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
    this.redis.on("error", () => undefined);
  }

  async get<T>(): Promise<T | null> {
    try {
      const raw = await this.redis?.get(KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.warn(err);
      return null;
    }
  }

  async set(value: unknown): Promise<void> {
    try {
      await this.redis?.set(KEY, JSON.stringify(value), "EX", TTL_SECONDS);
    } catch (err) {
      this.warn(err);
    }
  }

  /** After a write that changed tags, so a new tag is suggested straight away. */
  async clear(): Promise<void> {
    try {
      await this.redis?.del(KEY);
    } catch (err) {
      this.warn(err);
    }
  }

  private warn(err: unknown) {
    if (Date.now() - this.lastWarning < 60_000) return;
    this.lastWarning = Date.now();
    this.logger.warn(`Tag cache skipped, Redis unavailable: ${(err as Error).message}`);
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
