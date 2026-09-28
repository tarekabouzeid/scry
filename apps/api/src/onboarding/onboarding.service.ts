import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { teamJoinRequests, teams, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { CreateTeamOnboardingDto } from "./dto/create-team-onboarding.dto";

/**
 * Getting into a team. Joining one is a request its team admins approve;
 * creating one makes a team that waits for an admin's approval, after which
 * its creator is its first team admin. Until then people can look around
 * but not change anything.
 */
@Injectable()
export class OnboardingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async status(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException("User not found");

    if (user.teamId) {
      const [team] = await this.db.select().from(teams).where(eq(teams.id, user.teamId)).limit(1);
      return { hasTeam: true, team: team ?? null, pending: null };
    }
    const [request] = await this.db
      .select({ id: teamJoinRequests.id, team: teams })
      .from(teamJoinRequests)
      .innerJoin(teams, eq(teams.id, teamJoinRequests.teamId))
      .where(and(eq(teamJoinRequests.userId, userId), eq(teamJoinRequests.status, "pending")))
      .limit(1);
    if (request) {
      return {
        hasTeam: false,
        team: null,
        pending: { kind: "join" as const, requestId: request.id, team: request.team },
      };
    }
    const [created] = await this.db
      .select()
      .from(teams)
      .where(and(eq(teams.createdBy, userId), eq(teams.status, "pending")))
      .limit(1);
    return {
      hasTeam: false,
      team: null,
      pending: created ? { kind: "new_team" as const, team: created } : null,
    };
  }

  /** Once someone has a team (or is waiting for one), moving them is an admin action. */
  private async assertFree(userId: string) {
    const { hasTeam, pending } = await this.status(userId);
    if (hasTeam) {
      throw new ConflictException("You already belong to a team — ask an admin to change it");
    }
    if (pending) {
      throw new ConflictException(
        `You're already waiting to join ${pending.team.name} — withdraw that first`,
      );
    }
  }

  /** Ask to join an existing team. Its team admins approve or decline. */
  async requestToJoin(userId: string, teamId: string) {
    await this.assertFree(userId);
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team || team.status !== "active") throw new NotFoundException("Team not found");
    const [request] = await this.db.insert(teamJoinRequests).values({ userId, teamId }).returning();
    return { team, request: request! };
  }

  /** Create a new team; it waits for an admin's approval. */
  async createTeam(userId: string, dto: CreateTeamOnboardingDto) {
    await this.assertFree(userId);
    const [team] = await this.db
      .insert(teams)
      .values({ ...dto, status: "pending", createdBy: userId })
      .returning();
    return { team: team! };
  }

  /** Withdraw a pending request, or a new team that hasn't been approved yet. */
  async withdraw(userId: string) {
    const { pending } = await this.status(userId);
    if (!pending) throw new NotFoundException("Nothing is waiting for approval");
    if (pending.kind === "join") {
      await this.db.delete(teamJoinRequests).where(eq(teamJoinRequests.id, pending.requestId));
    } else {
      await this.db.delete(teams).where(eq(teams.id, pending.team.id));
    }
    return pending;
  }
}
