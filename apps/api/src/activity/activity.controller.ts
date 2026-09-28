import {
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
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
import { ActivityService } from "./activity.service";
import { CommentsService } from "./comments.service";
import { CreateCommentDto } from "./dto/create-comment.dto";

@ApiTags("activity")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller()
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly comments: CommentsService,
  ) {}

  @Get("initiatives/:id/activity")
  listActivity(@Param("id", ParseUUIDPipe) id: string) {
    return this.activity.list(id);
  }

  @Get("initiatives/:id/comments")
  listComments(@Param("id", ParseUUIDPipe) id: string) {
    return this.comments.list(id);
  }

  @Post("initiatives/:id/comments")
  createComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    // Until their team admin lets them in, people can read but not write.
    if (user.role !== "admin" && !user.teamId) {
      throw new ForbiddenException("You can comment once you're in a team");
    }
    return this.comments.create(user, id, dto.body);
  }

  @Delete("comments/:id")
  @HttpCode(204)
  async deleteComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.comments.remove(user, id);
  }
}
