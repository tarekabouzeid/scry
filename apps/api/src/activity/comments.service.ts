import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { comments, initiatives, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { ActivityService } from "./activity.service";
import { NotificationsService } from "../notifications/notifications.service";

const commentColumns = {
  id: comments.id,
  initiativeId: comments.initiativeId,
  authorId: comments.authorId,
  authorName: users.name,
  body: comments.body,
  createdAt: comments.createdAt,
};

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(initiativeId: string) {
    return this.db
      .select(commentColumns)
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.initiativeId, initiativeId))
      .orderBy(asc(comments.createdAt));
  }

  async create(user: AuthenticatedUser, initiativeId: string, body: string) {
    const [initiative] = await this.db
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, initiativeId))
      .limit(1);
    if (!initiative) throw new NotFoundException("Initiative not found");

    const [row] = await this.db
      .insert(comments)
      .values({ initiativeId, authorId: user.id, body: body.trim() })
      .returning();

    await this.activity.log(initiativeId, user.id, "commented", { commentId: row!.id });
    const preview = body.trim().length > 120 ? `${body.trim().slice(0, 117)}…` : body.trim();
    await this.notifications.notify({
      kind: "commented",
      initiative,
      actor: user,
      includeOwners: true,
      text: `${user.name} commented on "${initiative.title}": ${preview}`,
    });

    return { ...row!, authorName: user.name };
  }

  async remove(user: AuthenticatedUser, commentId: string) {
    const [row] = await this.db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!row) throw new NotFoundException("Comment not found");
    if (row.authorId !== user.id && user.role !== "admin") {
      throw new ForbiddenException("Only the author or an admin can delete this comment");
    }
    await this.db.delete(comments).where(eq(comments.id, commentId));
  }
}
