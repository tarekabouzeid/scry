import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { EdgesService } from "./edges.service";
import { CreateEdgeDto } from "./dto/create-edge.dto";
import { parseInitiativeIds, parseNeighbourhoodQuery } from "./graph-query";

@ApiTags("edges")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller()
export class EdgesController {
  constructor(private readonly edges: EdgesService) {}

  /** Edges touching any of `initiativeIds` (comma separated, at most 200). */
  @Get("edges")
  list(@Query("initiativeIds") initiativeIds?: string) {
    return this.edges.listFor(parseInitiativeIds(initiativeIds));
  }

  /**
   * An initiative (`initiativeId`) or a team's related work (`teamId`), and
   * what's up to `hops` (1–2) relationship steps away; at most `limit` (300)
   * initiatives, nearest first, with `truncated` set when there were more.
   */
  @Get("graph/neighbourhood")
  neighbourhood(
    @Query("initiativeId") initiativeId?: string,
    @Query("teamId") teamId?: string,
    @Query("hops") hops?: string,
    @Query("limit") limit?: string,
  ) {
    return this.edges.neighbourhood(parseNeighbourhoodQuery({ initiativeId, teamId, hops, limit }));
  }

  /** The organisation as a map: every team with work, and how their work connects. */
  @Get("graph/overview")
  overview() {
    return this.edges.overview();
  }

  /** One team's initiatives for the map, and every relationship touching them. */
  @Get("graph/teams/:teamId")
  teamGraph(@Param("teamId", ParseUUIDPipe) teamId: string) {
    return this.edges.teamGraph(teamId);
  }

  @Get("initiatives/:id/edges")
  listForInitiative(@Param("id", ParseUUIDPipe) id: string) {
    return this.edges.listForInitiative(id);
  }

  @Post("edges")
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEdgeDto) {
    return this.edges.create(user, dto);
  }

  @Delete("edges/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.edges.remove(user, id);
  }
}
