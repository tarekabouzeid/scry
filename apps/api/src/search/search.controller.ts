import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Observable } from "rxjs";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { SearchService } from "./search.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { SearchThrottle } from "../common/throttle";

function parseParams(q: string | undefined, topK?: string, expandHops?: string) {
  const query = q?.trim();
  if (!query) throw new BadRequestException("q is required");
  if (query.length > 500) throw new BadRequestException("q must be at most 500 characters");
  const clamp = (raw: string | undefined, fallback: number, max: number) => {
    const n = raw === undefined ? fallback : Number(raw);
    return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
  };
  // One step only: relationships are a hint of who to talk to, not a complete
  // graph worth walking; longer paths would lean on links nobody maintains.
  return { query, topK: clamp(topK, 10, 50), expandHops: clamp(expandHops, 1, 1) };
}

@SearchThrottle()
@ApiTags("search")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** "Does this already exist?" — checked live while someone drafts an initiative. */
  @Get("similar")
  similar(@CurrentUser() user: AuthenticatedUser, @Query("q") q: string) {
    const text = (q ?? "").trim();
    if (text.length < 12) throw new BadRequestException("Describe the idea in a few more words");
    return this.search.similarTo(text.slice(0, 4000), { id: user.id, email: user.email });
  }

  @Get()
  hybridSearch(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") q: string,
    @Query("topK") topK?: string,
    @Query("expandHops") expandHops?: string,
  ) {
    const params = parseParams(q, topK, expandHops);
    return this.search.hybridSearch(params.query, params.topK, params.expandHops, user);
  }

  /**
   * Same search, streamed as phase events (embedding -> vector_search ->
   * node_found* -> graph_expand -> node_found* -> results -> done) so the
   * graph view can animate it as it happens instead of showing a
   * final list.
   */
  @Sse("stream")
  hybridSearchStream(
    @CurrentUser() user: AuthenticatedUser,
    @Query("q") q: string,
    @Query("topK") topK?: string,
    @Query("expandHops") expandHops?: string,
  ): Observable<MessageEvent> {
    const params = parseParams(q, topK, expandHops);
    return this.search.hybridSearchStream(params.query, params.topK, params.expandHops, user);
  }
}
