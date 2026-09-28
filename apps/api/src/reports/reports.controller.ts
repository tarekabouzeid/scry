import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { BriefNarrative } from "@scry/shared";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { LlmThrottle } from "../common/throttle";
import { LlmService } from "../llm/llm.service";
import { ReportsService } from "./reports.service";
import { BriefQueryDto } from "./dto/brief-query.dto";
import { NARRATIVE_SYSTEM, citableIds, narrativePrompt, narrativeSchema } from "./narrative";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly llm: LlmService,
  ) {}

  private opts(q: BriefQueryDto) {
    const days = q.days ?? 90;
    return { days: days === 0 ? null : days, orgUnit: q.unit?.trim() || null };
  }

  /** The portfolio brief: every figure computed from the data, no AI involved. */
  @Get("brief")
  brief(@Query() q: BriefQueryDto) {
    return this.reports.brief(this.opts(q));
  }

  /**
   * An optional written summary of the same brief, drafted by the tasks
   * model from the brief's own figures. Points that cite nothing from the
   * brief are dropped, so the summary can't drift from the data.
   */
  @Post("brief/summary")
  @LlmThrottle()
  async summary(
    @CurrentUser() user: AuthenticatedUser,
    @Body() q: BriefQueryDto,
  ): Promise<BriefNarrative> {
    const brief = await this.reports.brief(this.opts(q));
    if (brief.totals.live === 0) throw new BadRequestException("There's nothing to summarise yet.");
    const known = citableIds(brief);

    const draft = await this.llm.object("tasks", {
      schema: narrativeSchema,
      system: NARRATIVE_SYSTEM,
      prompt: narrativePrompt(brief),
      caller: { id: user.id, email: user.email },
    });
    const points = draft.points
      .map((p) => ({
        text: p.text.trim(),
        initiativeIds: [...new Set(p.initiativeIds.filter((id) => known.has(id)))],
      }))
      .filter((p) => p.text && p.initiativeIds.length > 0)
      .slice(0, 4);
    return { headline: draft.headline.trim(), points, generatedAt: new Date().toISOString() };
  }
}
