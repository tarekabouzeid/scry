import { Logger } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import Redis from "ioredis";

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

// One round trip per request: count the hit, start the window on the first
// one, and start a block once the limit is passed.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return {hits, ttl, blocked}
`;

/**
 * Rate-limit counters in Redis, so limits hold across every api replica
 * (in-memory counters multiply the limit by the replica count).
 *
 * Fails open: if Redis is unreachable a request is allowed, not hung or
 * rejected — rate limiting is abuse protection, not something worth an
 * outage. Uses its own connection that gives up fast, unlike the queue's.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastWarning = 0;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = "scry:throttle:",
  ) {}

  static fromUrl(url: string) {
    return new RedisThrottlerStorage(
      new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
        lazyConnect: false,
      }),
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blockedMs] = (await this.redis.eval(
        INCREMENT,
        2,
        `${base}:hits`,
        `${base}:block`,
        String(ttl),
        String(limit),
        String(blockDuration || ttl),
      )) as [number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
        isBlocked: blockedMs > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockedMs / 1000)),
      };
    } catch (err) {
      if (Date.now() - this.lastWarning > 60_000) {
        this.lastWarning = Date.now();
        this.logger.warn(`Rate limiting skipped, Redis unavailable: ${(err as Error).message}`);
      }
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async close() {
    await this.redis.quit().catch(() => undefined);
  }
}
