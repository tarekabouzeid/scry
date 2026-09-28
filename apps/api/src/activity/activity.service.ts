import { Inject, Injectable, Logger } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { activity, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";

export type ActivityKind = (typeof activity.$inferInsert)["kind"];

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Best-effort: history is a record of what happened, never a reason for
   * the action itself to fail, so write errors are logged and swallowed.
   */
  async log(
    initiativeId: string,
    actorId: string | null,
    kind: ActivityKind,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.db.insert(activity).values({ initiativeId, actorId, kind, data });
    } catch (err) {
      this.logger.warn(`Failed to record ${kind} activity: ${(err as Error).message}`);
    }
  }

  async list(initiativeId: string) {
    return this.db
      .select({
        id: activity.id,
        initiativeId: activity.initiativeId,
        actorId: activity.actorId,
        actorName: users.name,
        kind: activity.kind,
        data: activity.data,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .leftJoin(users, eq(activity.actorId, users.id))
      .where(eq(activity.initiativeId, initiativeId))
      .orderBy(desc(activity.createdAt))
      .limit(200);
  }
}
