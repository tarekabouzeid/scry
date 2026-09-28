import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { OverlapsService } from "./overlaps.service";
import { ResolveOverlapDto } from "./dto/resolve-overlap.dto";
import { ListOverlapsDto } from "./dto/list-overlaps.dto";
import { parseInitiativeIds } from "../edges/graph-query";

@ApiTags("overlaps")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("overlaps")
export class OverlapsController {
  constructor(private readonly overlaps: OverlapsService) {}

  /**
   * Unresolved cross-team overlaps, strongest first: all of those involving
   * `initiativeIds` (comma separated, at most 200) when given, otherwise the
   * strongest 100 (or `limit`, max 500).
   */
  @Get()
  listOpen(@Query() q: ListOverlapsDto) {
    if (q.initiativeIds !== undefined) {
      return this.overlaps.listOpenFor(parseInitiativeIds(q.initiativeIds));
    }
    return this.overlaps.listOpen(q.limit);
  }

  /** How many overlaps are open in all. */
  @Get("count")
  async count() {
    return { open: await this.overlaps.countOpen() };
  }

  @Patch(":id")
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveOverlapDto,
  ) {
    return this.overlaps.resolve(user, id, dto.status);
  }
}
