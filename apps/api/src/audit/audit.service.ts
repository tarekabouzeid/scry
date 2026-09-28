import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { auditLog, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";

export type AuditAction =
  | "ai.settings_saved"
  | "ai.settings_removed"
  | "ai.signing_key_rotated"
  | "ai.reindexed"
  | "user.role_changed"
  | "user.team_changed"
  | "team.created"
  | "team.updated"
  | "team.merged"
  | "team.joined"
  | "team.requested"
  | "team.approved"
  | "team.declined"
  | "team.join_requested"
  | "team.member_approved"
  | "team.member_declined"
  | "team.member_removed"
  | "team.admin_granted"
  | "team.admin_revoked"
  | "token.created"
  | "token.revoked"
  | "initiatives.imported"
  | "initiatives.merged"
  | "mcp.enabled"
  | "mcp.disabled"
  | "mcp.connections_revoked";

export interface AuditActor {
  id: string;
  name: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Best effort by design: the change it describes has already happened, so
   * a failure to write the entry is logged loudly rather than failing the
   * request (which would suggest the change didn't happen).
   */
  async record(
    actor: AuditActor | null,
    action: AuditAction,
    summary: string,
    options: {
      targetType?: string;
      targetId?: string;
      /** The team it's about, so that team's admins see it too. */
      teamId?: string | null;
      data?: Record<string, unknown>;
    } = {},
  ) {
    try {
      await this.db.insert(auditLog).values({
        actorId: actor?.id ?? null,
        action,
        summary,
        targetType: options.targetType,
        targetId: options.targetId,
        teamId: options.teamId ?? null,
        data: options.data ?? {},
      });
    } catch (err) {
      this.logger.error(
        `Audit entry not written (${action}: ${summary}): ${(err as Error).message}`,
      );
    }
  }

  /** Newest first; `before` is the last entry of the previous page (exact keyset paging). */
  async list(options: {
    limit: number;
    before?: { createdAt: Date; id: string };
    action?: string;
    /** Only entries about this team (what a team admin sees). */
    teamId?: string;
  }) {
    const b = options.before;
    const conditions = [
      b
        ? or(
            lt(auditLog.createdAt, b.createdAt),
            and(eq(auditLog.createdAt, b.createdAt), lt(auditLog.id, b.id)),
          )
        : undefined,
      options.action ? eq(auditLog.action, options.action) : undefined,
      options.teamId ? eq(auditLog.teamId, options.teamId) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    return this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        summary: auditLog.summary,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
        actor: { id: users.id, name: users.name, email: users.email },
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(options.limit);
  }
}
