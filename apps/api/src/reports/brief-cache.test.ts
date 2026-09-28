import { describe, expect, it } from "vitest";
import type { PortfolioBrief } from "@scry/shared";
import { BRIEF_CACHE_SECONDS, BriefCache, briefCacheKey, type CacheStore } from "./brief-cache";

const brief = { generatedAt: "2026-09-27T12:00:00.000Z" } as PortfolioBrief;

function memoryStore() {
  const values = new Map<string, string>();
  const ttls: number[] = [];
  const store: CacheStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, _mode, seconds) => {
      values.set(key, value);
      ttls.push(seconds);
    },
  };
  return { store, ttls };
}

describe("BriefCache", () => {
  it("keys by period and org unit", () => {
    expect(briefCacheKey(90, null)).not.toBe(briefCacheKey(30, null));
    expect(briefCacheKey(null, "Security")).not.toBe(briefCacheKey(null, null));
    expect(briefCacheKey(null, null)).not.toBe(briefCacheKey(0, null));
  });

  it("returns a hit only while the data is unchanged, for five minutes", async () => {
    const { store, ttls } = memoryStore();
    const cache = new BriefCache(store);
    await cache.set("k", "v1", brief);
    expect(await cache.get("k", "v1")).toEqual(brief);
    expect(await cache.get("k", "v2")).toBeNull();
    expect(ttls).toEqual([BRIEF_CACHE_SECONDS]);
  });

  it("fails open when Redis is down or missing", async () => {
    const broken: CacheStore = {
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
    };
    for (const cache of [new BriefCache(broken), new BriefCache(null)]) {
      await expect(cache.set("k", "v", brief)).resolves.toBeUndefined();
      expect(await cache.get("k", "v")).toBeNull();
    }
  });
});
