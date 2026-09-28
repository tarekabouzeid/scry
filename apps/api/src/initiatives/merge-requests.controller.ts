import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { MergeService } from "./merge.service";

/** Answering a request to merge a duplicate into your work. */
@ApiTags("initiatives")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("merge-requests")
export class MergeRequestsController {
  constructor(private readonly merges: MergeService) {}

  /** The target's owners accept: the merge happens now. Returns the target. */
  @Post(":id/approve")
  approve(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.merges.approve(user, id);
  }

  @Post(":id/decline")
  @HttpCode(204)
  async decline(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.merges.decline(user, id);
  }

  @Post(":id/withdraw")
  @HttpCode(204)
  async withdraw(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.merges.withdraw(user, id);
  }
}
