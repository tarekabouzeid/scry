import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { TeamsService } from "./teams.service";
import { CreateTeamDto } from "./dto/create-team.dto";
import { UpdateTeamDto } from "./dto/update-team.dto";
import { MergeTeamDto } from "./dto/merge-team.dto";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertTeamOptions, teamOptions } from "./team-options";

class SetTeamAdminDto {
  @IsBoolean()
  teamAdmin!: boolean;
}

@ApiTags("teams")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("teams")
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Active teams; admins can ask for the ones waiting for approval too. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("includePending") includePending?: string) {
    return this.teams.list(user.role === "admin" && includePending === "true");
  }

  /** The org units and countries a team can be filed under. */
  @Get("options")
  options() {
    return teamOptions();
  }

  /** Every pending join request (admins), for the Admin page. */
  @Get("requests")
  @UseGuards(AdminGuard)
  allRequests() {
    return this.teams.pendingRequests();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.teams.getOrThrow(id);
  }

  // Admins create teams directly (people create them through onboarding,
  // where they wait for approval).
  @Post()
  @UseGuards(AdminGuard)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTeamDto) {
    assertTeamOptions(dto, { required: true });
    const team = await this.teams.create(dto);
    await this.audit.record(user, "team.created", `${user.name} created the team ${team.name}`, {
      targetType: "team",
      targetId: team.id,
      teamId: team.id,
    });
    return team;
  }

  @Post(":id/approve")
  @UseGuards(AdminGuard)
  async approve(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    const team = await this.teams.approve(id);
    await this.audit.record(
      user,
      "team.approved",
      `${user.name} approved the new team ${team.name}`,
      {
        targetType: "team",
        targetId: id,
        teamId: id,
      },
    );
    if (team.createdBy) {
      await this.notifications.notifyPeople({
        userIds: [team.createdBy],
        kind: "team_update",
        text: `${team.name} was approved. You're its team admin.`,
        actor: user,
        data: { teamId: id },
      });
    }
    return team;
  }

  @Post(":id/decline")
  @UseGuards(AdminGuard)
  async decline(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    const team = await this.teams.decline(id);
    await this.audit.record(
      user,
      "team.declined",
      `${user.name} declined the new team ${team.name}`,
      {
        targetType: "team",
        targetId: id,
        data: { name: team.name, createdBy: team.createdBy },
      },
    );
    if (team.createdBy) {
      await this.notifications.notifyPeople({
        userIds: [team.createdBy],
        kind: "team_update",
        text: `${user.name} didn't approve the new team ${team.name}. You can ask to join an existing team instead.`,
        actor: user,
      });
    }
    return { declined: true };
  }

  // --- Run a team: its team admins, or any admin.

  @Get(":id/members")
  members(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    this.teams.assertRunsTeam(user, id);
    return this.teams.members(id);
  }

  @Get(":id/requests")
  requests(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    this.teams.assertRunsTeam(user, id);
    return this.teams.pendingRequests(id);
  }

  @Post(":id/requests/:requestId/:decision")
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Param("decision") decision: string,
  ) {
    if (decision !== "approve" && decision !== "decline") {
      throw new BadRequestException("Approve or decline");
    }
    const approved = decision === "approve";
    const { user: person, team } = await this.teams.decideRequest(
      user,
      id,
      requestId,
      approved ? "approved" : "declined",
    );
    await this.audit.record(
      user,
      approved ? "team.member_approved" : "team.member_declined",
      approved
        ? `${user.name} let ${person.name} join ${team.name}`
        : `${user.name} declined ${person.name}'s request to join ${team.name}`,
      { targetType: "user", targetId: person.id, teamId: id },
    );
    await this.notifications.notifyPeople({
      userIds: [person.id],
      kind: "team_update",
      text: approved
        ? `${user.name} let you into ${team.name}`
        : `${user.name} declined your request to join ${team.name}`,
      actor: user,
      data: { teamId: id },
    });
    return { ok: true };
  }

  @Delete(":id/members/:userId")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    const member = await this.teams.removeMember(user, id, userId);
    const team = await this.teams.getOrThrow(id);
    await this.audit.record(
      user,
      "team.member_removed",
      `${user.name} removed ${member.name} from ${team.name}`,
      { targetType: "user", targetId: userId, teamId: id },
    );
    await this.notifications.notifyPeople({
      userIds: [userId],
      kind: "team_update",
      text: `${user.name} removed you from ${team.name}`,
      actor: user,
    });
    return { ok: true };
  }

  @Patch(":id/members/:userId")
  async setTeamAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: SetTeamAdminDto,
  ) {
    const member = await this.teams.setTeamAdmin(user, id, userId, dto.teamAdmin);
    const team = await this.teams.getOrThrow(id);
    await this.audit.record(
      user,
      dto.teamAdmin ? "team.admin_granted" : "team.admin_revoked",
      dto.teamAdmin
        ? `${user.name} made ${member.name} a team admin of ${team.name}`
        : `${user.name} took ${member.name}'s team admin rights for ${team.name}`,
      { targetType: "user", targetId: userId, teamId: id },
    );
    return member;
  }

  /** The team's own audit trail: who joined, left, and got admin rights. */
  @Get(":id/audit")
  auditLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit") limit?: string,
  ) {
    this.teams.assertRunsTeam(user, id);
    return this.audit.list({ limit: Math.min(Math.max(Number(limit) || 50, 1), 200), teamId: id });
  }

  @Patch(":id")
  @UseGuards(AdminGuard)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    assertTeamOptions(dto, { required: false });
    const before = await this.teams.getOrThrow(id);
    const team = await this.teams.update(id, dto);
    const changed = (["name", "orgUnit", "country"] as const).filter((k) => before[k] !== team[k]);
    if (changed.length) {
      await this.audit.record(
        user,
        "team.updated",
        before.name !== team.name
          ? `${user.name} renamed the team ${before.name} to ${team.name}`
          : `${user.name} updated the team ${team.name} (${changed.join(", ")})`,
        {
          targetType: "team",
          targetId: id,
          teamId: id,
          data: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: team[k] }])),
        },
      );
    }
    return team;
  }

  @Post(":id/merge")
  @UseGuards(AdminGuard)
  async merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MergeTeamDto,
  ) {
    const source = await this.teams.getOrThrow(id);
    const result = await this.teams.merge(id, dto.intoTeamId);
    await this.audit.record(
      user,
      "team.merged",
      `${user.name} merged ${source.name} into ${result.team.name} ` +
        `(${result.movedUsers} people, ${result.movedInitiatives} initiatives moved)`,
      {
        targetType: "team",
        targetId: result.team.id,
        data: { sourceTeamId: id, sourceName: source.name, ...result, team: undefined },
      },
    );
    return result;
  }
}
