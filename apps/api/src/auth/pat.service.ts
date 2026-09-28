import { randomBytes, createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, sql as rawSql } from "drizzle-orm";
import { personalAccessTokens, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";

const TOKEN_PREFIX = "scry_pat_";

export type TokenScope = "read" | "write";

@Injectable()
export class PatService {
  private readonly logger = new Logger(PatService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async issue(
    userId: string,
    name?: string,
    expiresInDays?: number,
    scope: TokenScope = "read",
  ): Promise<string> {
    const raw = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    await this.db.insert(personalAccessTokens).values({
      userId,
      tokenHash: this.hash(raw),
      name,
      scope,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : undefined,
    });
    return raw;
  }

  /** The user's tokens — metadata only; the raw token is never retrievable. */
  async list(userId: string) {
    return this.db
      .select({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        scope: personalAccessTokens.scope,
        createdAt: personalAccessTokens.createdAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        expiresAt: personalAccessTokens.expiresAt,
      })
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.userId, userId))
      .orderBy(desc(personalAccessTokens.createdAt));
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(personalAccessTokens)
      .where(and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, userId)))
      .returning({ id: personalAccessTokens.id });
    return deleted.length > 0;
  }

  /** The user a valid, non-expired PAT belongs to, with the token's scope; or null. */
  async resolve(rawToken: string) {
    if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = this.hash(rawToken);

    const [row] = await this.db
      .select({
        user: users,
        patId: personalAccessTokens.id,
        name: personalAccessTokens.name,
        scope: personalAccessTokens.scope,
        expiresAt: personalAccessTokens.expiresAt,
      })
      .from(personalAccessTokens)
      .innerJoin(users, eq(personalAccessTokens.userId, users.id))
      .where(eq(personalAccessTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    // Fire-and-forget last-used bookkeeping — never block the request on it.
    // Drizzle builders are lazy thenables: without .then()/.catch() the
    // UPDATE is never sent, so attach a handler to actually execute it.
    this.db
      .update(personalAccessTokens)
      .set({ lastUsedAt: rawSql`now()` })
      .where(eq(personalAccessTokens.id, row.patId))
      .catch((err: Error) => this.logger.warn(`Failed to record PAT use: ${err.message}`));

    return { user: row.user, scope: row.scope, id: row.patId, name: row.name };
  }
}
