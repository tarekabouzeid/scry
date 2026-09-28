import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { NotificationsService } from "./notifications.service";
import { SubscribeDto } from "./dto/subscribe.dto";

/** The signed-in user's own inbox and subscriptions. */
@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller()
export class InboxController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("me/notifications")
  inbox(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.inbox(user.id);
  }

  @Post("me/notifications/read")
  @HttpCode(204)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notifications.markRead(user.id);
  }

  @Post("me/notifications/:id/read")
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user.id, id);
  }

  @Get("me/subscriptions")
  subscriptions(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listSubscriptions(user.id);
  }

  @Post("me/subscriptions")
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.notifications.subscribe(user.id, dto.targetType, dto.targetValue);
  }

  @Delete("me/subscriptions/:id")
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.notifications.unsubscribe(user.id, id);
  }
}
