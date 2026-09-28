import { Body, Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { OnboardingService } from "./onboarding.service";
import { JoinTeamDto } from "./dto/join-team.dto";
import { CreateTeamOnboardingDto } from "./dto/create-team-onboarding.dto";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import { assertTeamOptions } from "../teams/team-options";

@ApiTags("onboarding")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("onboarding")
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.status(user.id);
  }

  /** Ask to join a team; its team admins decide. */
  @Post("join")
  async join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinTeamDto) {
    const result = await this.onboarding.requestToJoin(user.id, dto.teamId);
    await this.audit.record(
      user,
      "team.join_requested",
      `${user.name} asked to join ${result.team.name}`,
      { targetType: "team", targetId: result.team.id, teamId: result.team.id },
    );
    await this.notifications.notifyPeople({
      userIds: await this.notifications.teamDeciders(result.team.id),
      kind: "team_request",
      text: `${user.name} asked to join ${result.team.name}`,
      actor: user,
      data: { teamId: result.team.id },
    });
    return this.onboarding.status(user.id);
  }

  /** Create a team; an admin approves it before anyone can use it. */
  @Post("create-team")
  async createTeam(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTeamOnboardingDto) {
    assertTeamOptions(dto, { required: true });
    const { team } = await this.onboarding.createTeam(user.id, dto);
    await this.audit.record(
      user,
      "team.requested",
      `${user.name} asked to create the team ${team.name}`,
      { targetType: "team", targetId: team.id, teamId: team.id },
    );
    await this.notifications.notifyPeople({
      userIds: await this.notifications.adminIds(),
      kind: "team_request",
      text: `${user.name} asked to create the team ${team.name}`,
      actor: user,
      data: { teamId: team.id, newTeam: true },
    });
    return this.onboarding.status(user.id);
  }

  @Delete("pending")
  async withdraw(@CurrentUser() user: AuthenticatedUser) {
    await this.onboarding.withdraw(user.id);
    return this.onboarding.status(user.id);
  }
}
