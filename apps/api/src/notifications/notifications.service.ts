import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  initiatives,
  notifications,
  subscriptions,
  teams,
  users,
  type Db,
  type PublicInitiativeRow,
} from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";

export type NotificationKind = (typeof notifications.$inferInsert)["kind"];
export type SubscriptionTarget = (typeof subscriptions.$inferInsert)["targetType"];

export interface NotifyEvent {
  kind: NotificationKind;
  initiative: Pick<
    PublicInitiativeRow,
    "id" | "title" | "teamId" | "tags" | "submittedBy" | "contactPerson"
  >;
  /** Who caused it — never notified about their own action. Null for system events. */
  actor: Pick<AuthenticatedUser, "id"> | null;
  text: string;
  /** Also notify the initiative's submitter + contact person, subscribed or not. */
  includeOwners?: boolean;
  /** Also notify these people (e.g. the team's admins), subscribed or not. */
  alsoNotify?: string[];
  data?: Record<string, unknown>;
}

interface Digest {
  text: string;
  newCount: number;
  updatedCount: number;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  /**
   * Fan an event out to everyone following it: explicit subscribers of the
   * initiative, its team, or any of its tags — plus its owners when the
   * event is something done *to* their work by someone else. Best-effort:
   * a notification failure never fails the action that triggered it.
   */
  async notify(event: NotifyEvent): Promise<void> {
    try {
      const { initiative } = event;
      const conditions = [
        and(
          eq(subscriptions.targetType, "initiative"),
          eq(subscriptions.targetValue, initiative.id),
        ),
        and(eq(subscriptions.targetType, "team"), eq(subscriptions.targetValue, initiative.teamId)),
      ];
      if (initiative.tags.length) {
        conditions.push(
          and(
            eq(subscriptions.targetType, "tag"),
            inArray(subscriptions.targetValue, initiative.tags),
          ),
        );
      }
      const subscribers = await this.db
        .selectDistinct({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(or(...conditions));

      const recipients = new Set(subscribers.map((s) => s.userId));
      if (event.includeOwners) {
        recipients.add(initiative.submittedBy);
        recipients.add(initiative.contactPerson);
      }
      for (const id of event.alsoNotify ?? []) recipients.add(id);
      if (event.actor) recipients.delete(event.actor.id);

      if (recipients.size) {
        await this.db.insert(notifications).values(
          [...recipients].map((userId) => ({
            userId,
            kind: event.kind,
            initiativeId: initiative.id,
            actorId: event.actor?.id ?? null,
            text: event.text,
            data: event.data ?? {},
          })),
        );
      }

      this.sendAlert(event.text);
    } catch (err) {
      this.logger.warn(`Failed to notify ${event.kind}: ${(err as Error).message}`);
    }
  }

  /**
   * Tell specific people, not followers: a request to join a team or to
   * merge into their work, and the answer. Never the actor; best-effort
   * like notify().
   */
  async notifyPeople(event: {
    userIds: string[];
    kind: "team_request" | "team_update" | "merge_request" | "merge_update";
    text: string;
    /** What it's about, so the inbox can open it. */
    initiativeId?: string;
    actor?: { id: string } | null;
    data?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const recipients = [...new Set(event.userIds)].filter((id) => id !== event.actor?.id);
      if (!recipients.length) return;
      await this.db.insert(notifications).values(
        recipients.map((userId) => ({
          userId,
          kind: event.kind,
          initiativeId: event.initiativeId ?? null,
          actorId: event.actor?.id ?? null,
          text: event.text,
          data: event.data ?? {},
        })),
      );
      // Merge requests reach the team chat like other initiative events.
      if (event.initiativeId) this.sendAlert(event.text);
    } catch (err) {
      this.logger.warn(`Failed to notify ${event.kind}: ${(err as Error).message}`);
    }
  }

  /** A team's team admins (none if it has none). */
  async teamAdminIds(teamId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.teamId, teamId), eq(users.teamAdmin, true)));
    return rows.map((u) => u.id);
  }

  /** Who decides on a team's join requests: its team admins, or admins if it has none. */
  async teamDeciders(teamId: string): Promise<string[]> {
    const teamAdmins = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.teamId, teamId), eq(users.teamAdmin, true)));
    return teamAdmins.length ? teamAdmins.map((u) => u.id) : this.adminIds();
  }

  async adminIds(): Promise<string[]> {
    const admins = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"));
    return admins.map((u) => u.id);
  }

  /**
   * Real-time alerts to the team chat webhook — opt-in via
   * NOTIFICATIONS_ALERTS=true so existing digest-only setups don't suddenly
   * get a message per event. Fire-and-forget.
   */
  private sendAlert(text: string): void {
    if (this.config.get<string>("NOTIFICATIONS_ALERTS") !== "true") return;
    this.sendWebhook(`🔮 ${text}`).catch((err: Error) =>
      this.logger.warn(`Alert webhook failed: ${err.message}`),
    );
  }

  async inbox(userId: string) {
    const [items, [unread]] = await Promise.all([
      this.db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          initiativeId: notifications.initiativeId,
          actorId: notifications.actorId,
          text: notifications.text,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(50),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);
    return { items, unreadCount: unread?.count ?? 0 };
  }

  async markRead(userId: string, id?: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          id ? eq(notifications.id, id) : undefined,
        ),
      );
  }

  async listSubscriptions(userId: string) {
    return this.db
      .select({
        id: subscriptions.id,
        targetType: subscriptions.targetType,
        targetValue: subscriptions.targetValue,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(subscriptions.createdAt);
  }

  async subscribe(userId: string, targetType: SubscriptionTarget, targetValue: string) {
    const value = targetType === "tag" ? targetValue.trim().toLowerCase() : targetValue;
    // Following a tag nobody uses would never notify anyone; it's almost always a typo.
    if (targetType === "tag") {
      const [used] = await this.db.execute<{ one: number }>(
        sql`select 1 as one from initiatives where merged_into_id is null and ${value} = any(tags) limit 1`,
      );
      if (!used) throw new BadRequestException(`No initiative is tagged #${value}`);
    }
    await this.db
      .insert(subscriptions)
      .values({ userId, targetType, targetValue: value })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.targetType, targetType),
          eq(subscriptions.targetValue, value),
        ),
      )
      .limit(1);
    return row!;
  }

  async unsubscribe(userId: string, id: string) {
    await this.db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId)));
  }

  async buildDigest(sinceDays = 7): Promise<Digest> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const [recent, allTeams] = await Promise.all([
      this.db.select().from(initiatives).where(gte(initiatives.updatedAt, since)),
      this.db.select().from(teams),
    ]);
    const teamName = (teamId: string) => allTeams.find((t) => t.id === teamId)?.name ?? teamId;

    const newOnes = recent.filter((i) => i.createdAt >= since);
    const updatedOnes = recent.filter((i) => i.createdAt < since);

    const lines: string[] = [
      `Scry weekly digest — ${newOnes.length} new, ${updatedOnes.length} updated`,
      "",
    ];
    if (newOnes.length) {
      lines.push("New initiatives:");
      for (const i of newOnes) lines.push(`  • [${teamName(i.teamId)}] ${i.title}`);
      lines.push("");
    }
    if (updatedOnes.length) {
      lines.push("Updated initiatives:");
      for (const i of updatedOnes) lines.push(`  • [${teamName(i.teamId)}] ${i.title}`);
    }

    return { text: lines.join("\n"), newCount: newOnes.length, updatedCount: updatedOnes.length };
  }

  async sendDigest(): Promise<void> {
    const digest = await this.buildDigest();
    if (digest.newCount === 0 && digest.updatedCount === 0) {
      this.logger.log("Nothing to report this week — skipping digest send.");
      return;
    }

    const channel = this.config.get<string>("NOTIFICATIONS_CHANNEL");
    if (channel === "webhook") {
      await this.sendWebhook(digest.text);
    } else if (channel === "email") {
      await this.sendEmail(digest.text);
    } else {
      this.logger.warn(
        "NOTIFICATIONS_CHANNEL not set to 'email' or 'webhook' — digest built but not sent.",
      );
    }
  }

  private async sendWebhook(text: string): Promise<void> {
    const url = this.config.get<string>("NOTIFICATIONS_WEBHOOK_URL");
    if (!url) {
      this.logger.warn("NOTIFICATIONS_WEBHOOK_URL missing — cannot send webhook digest.");
      return;
    }
    // Slack/Matrix-compatible incoming-webhook shape: {"text": "..."}
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      // fetch only rejects on network errors — surface HTTP failures too, so
      // the job is marked failed instead of silently "succeeding".
      throw new Error(`Digest webhook responded ${res.status} ${res.statusText}`);
    }
  }

  private async sendEmail(text: string): Promise<void> {
    const host = this.config.get<string>("SMTP_HOST");
    const to = this.config.get<string>("NOTIFICATIONS_EMAIL_TO");
    if (!host || !to) {
      this.logger.warn("SMTP_HOST/NOTIFICATIONS_EMAIL_TO missing — cannot send email digest.");
      return;
    }

    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host,
      port: Number(this.config.get<string>("SMTP_PORT")) || 587,
      auth: this.config.get<string>("SMTP_USER")
        ? {
            user: this.config.get<string>("SMTP_USER"),
            pass: this.config.get<string>("SMTP_PASS"),
          }
        : undefined,
    });

    await transport.sendMail({
      from: this.config.get<string>("SMTP_FROM") ?? "scry@localhost",
      to,
      subject: "Scry weekly digest",
      text,
    });
  }
}
