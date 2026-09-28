import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { initiatives, subscriptions, teamJoinRequests, teams, users, type Db } from "@scry/db";
import type { AuthenticatedUser } from "../auth/types";
import { DB } from "../db/db.module";
import type { CreateTeamDto } from "./dto/create-team.dto";
import type { UpdateTeamDto } from "./dto/update-team.dto";

@Injectable()
export class TeamsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Active teams; admins also see teams still waiting for approval. */
  async list(includePending = false) {
    return this.db
      .select()
      .from(teams)
      .where(includePending ? undefined : eq(teams.status, "active"))
      .orderBy(teams.name);
  }

  /** Admins run every team; a team admin runs their own. */
  assertRunsTeam(user: AuthenticatedUser, teamId: string) {
    if (user.role === "admin") return;
    if (user.teamAdmin && user.teamId === teamId) return;
    throw new ForbiddenException("Only this team's admins can do that");
  }

  async members(teamId: string) {
    await this.getOrThrow(teamId);
    return this.db
      .select({ id: users.id, name: users.name, email: users.email, teamAdmin: users.teamAdmin })
      .from(users)
      .where(eq(users.teamId, teamId))
      .orderBy(asc(users.name));
  }

  /** Pending join requests: for one team, or (admins) every team. */
  async pendingRequests(teamId?: string) {
    return this.db
      .select({
        id: teamJoinRequests.id,
        teamId: teamJoinRequests.teamId,
        status: teamJoinRequests.status,
        createdAt: teamJoinRequests.createdAt,
        user: { id: users.id, name: users.name, email: users.email },
      })
      .from(teamJoinRequests)
      .innerJoin(users, eq(users.id, teamJoinRequests.userId))
      .where(
        and(
          eq(teamJoinRequests.status, "pending"),
          teamId ? eq(teamJoinRequests.teamId, teamId) : undefined,
        ),
      )
      .orderBy(asc(teamJoinRequests.createdAt));
  }

  /** Approve or decline a join request; approving puts the person in the team. */
  async decideRequest(
    actor: AuthenticatedUser,
    teamId: string,
    requestId: string,
    decision: "approved" | "declined",
  ) {
    this.assertRunsTeam(actor, teamId);
    const [request] = await this.db
      .select()
      .from(teamJoinRequests)
      .where(and(eq(teamJoinRequests.id, requestId), eq(teamJoinRequests.teamId, teamId)))
      .limit(1);
    if (!request) throw new NotFoundException("Request not found");
    if (request.status !== "pending")
      throw new ConflictException("This request was already decided");
    const [person] = await this.db.select().from(users).where(eq(users.id, request.userId));
    if (decision === "approved" && person?.teamId) {
      throw new ConflictException(`${person.name} already belongs to a team`);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(teamJoinRequests)
        .set({ status: decision, decidedBy: actor.id, decidedAt: new Date() })
        .where(eq(teamJoinRequests.id, requestId));
      if (decision === "approved") {
        await tx
          .update(users)
          .set({ teamId, teamAdmin: false, updatedAt: new Date() })
          .where(eq(users.id, request.userId));
      }
    });
    return { user: person!, team: await this.getOrThrow(teamId) };
  }

  private async teamAdminCount(teamId: string, except?: string) {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.teamId, teamId),
          eq(users.teamAdmin, true),
          except ? ne(users.id, except) : undefined,
        ),
      );
    return row?.n ?? 0;
  }

  private async memberOrThrow(teamId: string, userId: string) {
    const [member] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.teamId, teamId)))
      .limit(1);
    if (!member) throw new NotFoundException("Not a member of this team");
    return member;
  }

  /** Take someone out of the team; they're back to having no team. */
  async removeMember(actor: AuthenticatedUser, teamId: string, userId: string) {
    this.assertRunsTeam(actor, teamId);
    const member = await this.memberOrThrow(teamId, userId);
    const [others] = await this.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.teamId, teamId), ne(users.id, userId)));
    if (member.teamAdmin && others?.n && !(await this.teamAdminCount(teamId, userId))) {
      throw new ConflictException("Make someone else a team admin first");
    }
    await this.db
      .update(users)
      .set({ teamId: null, teamAdmin: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return member;
  }

  /** Give or take team admin rights; a team with members keeps at least one. */
  async setTeamAdmin(actor: AuthenticatedUser, teamId: string, userId: string, teamAdmin: boolean) {
    this.assertRunsTeam(actor, teamId);
    const member = await this.memberOrThrow(teamId, userId);
    if (member.teamAdmin && !teamAdmin && !(await this.teamAdminCount(teamId, userId))) {
      throw new ConflictException(
        "A team needs at least one team admin — make someone else one first",
      );
    }
    await this.db
      .update(users)
      .set({ teamAdmin, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { ...member, teamAdmin };
  }

  /** An admin approves a team created during onboarding; its creator joins as team admin. */
  async approve(teamId: string) {
    const team = await this.getOrThrow(teamId);
    if (team.status !== "pending") throw new ConflictException("This team is already active");
    const [row] = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(teams)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(teams.id, teamId))
        .returning();
      if (team.createdBy) {
        await tx
          .update(users)
          .set({ teamId, teamAdmin: true, updatedAt: new Date() })
          .where(and(eq(users.id, team.createdBy)));
      }
      return updated;
    });
    return row!;
  }

  /** An admin declines a team created during onboarding: it's removed. */
  async decline(teamId: string) {
    const team = await this.getOrThrow(teamId);
    if (team.status !== "pending")
      throw new ConflictException("Only a team awaiting approval can be declined");
    await this.db.delete(teams).where(eq(teams.id, teamId));
    return team;
  }

  async getOrThrow(id: string) {
    const [row] = await this.db.select().from(teams).where(eq(teams.id, id)).limit(1);
    if (!row) throw new NotFoundException("Team not found");
    return row;
  }

  async create(dto: CreateTeamDto) {
    const [row] = await this.db
      .insert(teams)
      .values({ ...dto, status: "active" })
      .returning();
    return row!;
  }

  async update(id: string, dto: UpdateTeamDto) {
    await this.getOrThrow(id);
    const [row] = await this.db
      .update(teams)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(teams.id, id))
      .returning();
    return row!;
  }

  /**
   * Fold one team into another (duplicates from self-serve onboarding):
   * members, initiatives and team subscriptions move over, then the source
   * team is deleted. Admin-only (enforced by the controller).
   */
  async merge(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException("Cannot merge a team into itself");
    await this.getOrThrow(sourceId);
    const target = await this.getOrThrow(targetId);

    const moved = await this.db.transaction(async (tx) => {
      const now = new Date();
      const movedUsers = await tx
        .update(users)
        .set({ teamId: targetId, updatedAt: now })
        .where(eq(users.teamId, sourceId))
        .returning({ id: users.id });
      const movedInitiatives = await tx
        .update(initiatives)
        .set({ teamId: targetId, updatedAt: now })
        .where(eq(initiatives.teamId, sourceId))
        .returning({ id: initiatives.id });
      // Re-point team subscriptions, dropping ones that would now duplicate.
      const subs = await tx
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.targetType, "team"), eq(subscriptions.targetValue, sourceId)));
      for (const sub of subs) {
        await tx
          .insert(subscriptions)
          .values({ userId: sub.userId, targetType: "team", targetValue: targetId })
          .onConflictDoNothing();
      }
      await tx
        .delete(subscriptions)
        .where(and(eq(subscriptions.targetType, "team"), eq(subscriptions.targetValue, sourceId)));
      await tx.delete(teams).where(eq(teams.id, sourceId));
      return { users: movedUsers.length, initiatives: movedInitiatives.length };
    });

    return { team: target, movedUsers: moved.users, movedInitiatives: moved.initiatives };
  }
}
