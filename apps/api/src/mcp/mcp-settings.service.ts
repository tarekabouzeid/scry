import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { desc, eq, lt, sql } from "drizzle-orm";
import { appSettings, mcpCalls, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";

const PRUNE_EVERY_MS = 60 * 60_000;

export interface McpCallRecord {
  userId: string;
  client: string;
  via: "oauth" | "token";
  grantId: string | null;
  tool: string;
  input: Record<string, unknown>;
  resultIds: string[];
  ok: boolean;
}

/** The admin switch for MCP, and the log of every tool call. */
@Injectable()
export class McpSettingsService {
  private readonly logger = new Logger(McpSettingsService.name);
  private lastPrune = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Off until an admin turns it on (no row yet means off). */
  async enabled(): Promise<boolean> {
    const [row] = await this.db
      .select({ on: appSettings.mcpEnabled })
      .from(appSettings)
      .where(eq(appSettings.id, "default"));
    return row?.on ?? false;
  }

  async setEnabled(user: AuthenticatedUser, enabled: boolean) {
    await this.db
      .insert(appSettings)
      .values({ id: "default", mcpEnabled: enabled, updatedBy: user.id })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: { mcpEnabled: enabled, updatedBy: user.id, updatedAt: new Date() },
      });
    await this.audit.record(
      user,
      enabled ? "mcp.enabled" : "mcp.disabled",
      `${user.name} ${enabled ? "let people connect AI tools (MCP)" : "turned off AI tool connections (MCP)"}`,
      { targetType: "settings", targetId: "mcp" },
    );
    return { enabled };
  }

  get retentionDays(): number {
    const n = Number(this.config.get<string>("MCP_LOG_RETENTION_DAYS") ?? 90);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 90;
  }

  /** Fire-and-forget: logging must never slow down or fail a tool call. */
  record(call: McpCallRecord) {
    this.db
      .insert(mcpCalls)
      .values({ ...call, resultIds: call.resultIds.slice(0, 100) })
      .catch((err: Error) => this.logger.warn(`MCP call not logged: ${err.message}`));
    if (Date.now() - this.lastPrune > PRUNE_EVERY_MS) {
      this.lastPrune = Date.now();
      this.db
        .delete(mcpCalls)
        .where(lt(mcpCalls.createdAt, sql`now() - make_interval(days => ${this.retentionDays})`))
        .catch(() => undefined);
    }
  }

  /** The most recent calls, newest first; optionally one person's. */
  async recentCalls(opts: { userId?: string; limit: number }) {
    const rows = await this.db
      .select({
        id: mcpCalls.id,
        user: { id: users.id, name: users.name, email: users.email },
        client: mcpCalls.client,
        via: mcpCalls.via,
        tool: mcpCalls.tool,
        input: mcpCalls.input,
        resultIds: mcpCalls.resultIds,
        ok: mcpCalls.ok,
        createdAt: mcpCalls.createdAt,
      })
      .from(mcpCalls)
      .innerJoin(users, eq(users.id, mcpCalls.userId))
      .where(opts.userId ? eq(mcpCalls.userId, opts.userId) : undefined)
      .orderBy(desc(mcpCalls.createdAt))
      .limit(opts.limit);
    return rows;
  }

  /** Who used MCP in the retention window, and how much. */
  async people() {
    return this.db
      .select({
        user: { id: users.id, name: users.name, email: users.email },
        calls: sql<number>`count(*)::int`,
        clients: sql<string[]>`array_agg(distinct ${mcpCalls.client})`,
        lastCallAt: sql<Date>`max(${mcpCalls.createdAt})`,
      })
      .from(mcpCalls)
      .innerJoin(users, eq(users.id, mcpCalls.userId))
      .groupBy(users.id)
      .orderBy(sql`max(${mcpCalls.createdAt}) desc`)
      .limit(200);
  }
}
