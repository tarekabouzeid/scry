import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "../auth/session.service";

const MINUTE = 60_000;

/**
 * Rate limits count per caller, not per IP: everyone behind one office NAT
 * would otherwise share a budget. The guard runs before authentication, so
 * the caller is identified by (a hash of) the credential they present — the
 * session cookie or bearer token — and falls back to the client IP.
 */
export function throttleKey(req: {
  headers?: { authorization?: string };
  cookies?: Record<string, string | undefined>;
  ip?: string;
}): string {
  const bearer = req.headers?.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const credential = bearer ?? req.cookies?.[SESSION_COOKIE_NAME];
  if (credential) {
    return `cred:${createHash("sha256").update(credential).digest("hex").slice(0, 32)}`;
  }
  return `ip:${req.ip ?? "unknown"}`;
}

@Injectable()
export class ScryThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return throttleKey(req as unknown as Request);
  }
}

/** The global budget — generous; the UI makes a handful of calls per click. */
export const DEFAULT_THROTTLE = { name: "default", ttl: MINUTE, limit: 600 };

/** Endpoints that call the LLM: each request costs money and seconds. */
export const LlmThrottle = () => Throttle({ default: { ttl: MINUTE, limit: 20 } });

/** Semantic search embeds the query on every call (and the graph view types-ahead). */
export const SearchThrottle = () => Throttle({ default: { ttl: MINUTE, limit: 60 } });

/** Sign-in, OAuth and token minting: slow down guessing and abuse. */
export const AuthThrottle = () => Throttle({ default: { ttl: MINUTE, limit: 30 } });

/** Bulk writes (imports). */
export const BulkThrottle = () => Throttle({ default: { ttl: MINUTE, limit: 10 } });
