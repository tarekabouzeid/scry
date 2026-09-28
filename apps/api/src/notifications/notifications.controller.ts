import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, AdminGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Manual trigger for local/dev verification — the real schedule is the queue's repeatable job. */
  @Post("digest/trigger")
  @ApiOkResponse({ description: "Builds and sends the digest immediately." })
  async trigger() {
    await this.notifications.sendDigest();
    return { triggered: true };
  }
}
