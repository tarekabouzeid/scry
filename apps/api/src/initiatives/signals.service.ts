import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DEMAND_STALE_AFTER_DAYS } from "@scry/shared";
import { initiativeSignals, teams, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import { ActivityService } from "../activity/activity.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InitiativesService } from "./initiatives.service";
import { JobsService } from "../jobs/jobs.service";

/** "We need this too" — other teams saying an initiative matters to them. */
@Injectable()
export class SignalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly initiatives: InitiativesService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  async list(initiativeId: string) {
    await this.initiatives.getOrThrow(initiativeId);
    const rows = await this.db
      .select({
        id: initiativeSignals.id,
        note: initiativeSignals.note,
        createdAt: initiativeSignals.createdAt,
        confirmedAt: initiativeSignals.confirmedAt,
        user: { id: users.id, name: users.name },
        team: { id: teams.id, name: teams.name },
      })
      .from(initiativeSignals)
      .innerJoin(users, eq(users.id, initiativeSignals.userId))
      .innerJoin(teams, eq(teams.id, initiativeSignals.teamId))
      .where(eq(initiativeSignals.initiativeId, initiativeId))
      .orderBy(asc(initiativeSignals.createdAt));
    const staleBefore = Date.now() - DEMAND_STALE_AFTER_DAYS * 86_400_000;
    return rows.map((r) => ({ ...r, stale: r.confirmedAt.getTime() < staleBefore }));
  }

  /** Say (or say again, which confirms it's still needed) that your team needs this. */
  async add(user: AuthenticatedUser, initiativeId: string, note: string) {
    const initiative = await this.initiatives.getOrThrow(initiativeId);
    if (!user.teamId) throw new BadRequestException("Join a team first");
    if (initiative.teamId === user.teamId) {
      throw new BadRequestException("It's your own team's initiative");
    }
    if (initiative.mergedIntoId) {
      throw new BadRequestException(
        "This was merged — add your signal to the initiative it went to",
      );
    }
    const trimmed = note.trim();
    const [existing] = await this.db
      .select({ id: initiativeSignals.id })
      .from(initiativeSignals)
      .where(
        and(
          eq(initiativeSignals.initiativeId, initiativeId),
          eq(initiativeSignals.userId, user.id),
        ),
      );
    await this.db
      .insert(initiativeSignals)
      .values({ initiativeId, userId: user.id, teamId: user.teamId, note: trimmed })
      .onConflictDoUpdate({
        target: [initiativeSignals.initiativeId, initiativeSignals.userId],
        set: { note: trimmed, teamId: user.teamId, confirmedAt: new Date() },
      });

    // Only the first signal is news; editing the note isn't worth a ping.
    if (!existing) {
      const [team] = await this.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, user.teamId));
      await this.activity.log(initiativeId, user.id, "signal_added", {
        teamId: user.teamId,
        teamName: team?.name,
        note: trimmed,
      });
      await this.notifications.notify({
        kind: "signal_added",
        initiative,
        actor: user,
        includeOwners: true,
        text:
          `${user.name} (${team?.name ?? "another team"}) needs "${initiative.title}" too` +
          (trimmed ? `: “${trimmed.slice(0, 120)}”` : ""),
        data: { teamId: user.teamId },
      });
    }
    this.jobs.enqueueTldr(initiativeId);
    return this.list(initiativeId);
  }

  async remove(user: AuthenticatedUser, initiativeId: string) {
    await this.db
      .delete(initiativeSignals)
      .where(
        and(
          eq(initiativeSignals.initiativeId, initiativeId),
          eq(initiativeSignals.userId, user.id),
        ),
      );
    this.jobs.enqueueTldr(initiativeId);
    return this.list(initiativeId);
  }
}
