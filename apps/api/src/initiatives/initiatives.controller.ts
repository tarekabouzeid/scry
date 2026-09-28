import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { InitiativesService } from "./initiatives.service";
import { CreateInitiativeDto } from "./dto/create-initiative.dto";
import { UpdateInitiativeDto } from "./dto/update-initiative.dto";
import {
  CountInitiativesQueryDto,
  ListInitiativesQueryDto,
  LookupInitiativesQueryDto,
} from "./dto/list-initiatives.query.dto";
import { ImportInitiativesDto } from "./dto/import-initiatives.dto";
import { BulkThrottle, LlmThrottle } from "../common/throttle";
import { AssistService } from "./assist.service";
import { AssistInitiativeDto } from "./dto/assist.dto";
import { AuditService } from "../audit/audit.service";
import { MergeService } from "./merge.service";
import { SignalsService } from "./signals.service";
import { MergeInitiativeDto } from "./dto/merge.dto";
import { SignalDto } from "./dto/signal.dto";

@ApiTags("initiatives")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("initiatives")
export class InitiativesController {
  constructor(
    private readonly initiatives: InitiativesService,
    private readonly audit: AuditService,
    private readonly merges: MergeService,
    private readonly signals: SignalsService,
    private readonly assistant: AssistService,
  ) {}

  /** One page at a time; follow `nextCursor` for the rest. */
  @Get()
  list(@Query() query: ListInitiativesQueryDto) {
    return this.initiatives.list(query);
  }

  /** Totals per status or per team, with the same filters as the list. */
  @Get("counts")
  counts(@Query() query: CountInitiativesQueryDto) {
    return this.initiatives.counts(query);
  }

  /** Several initiatives by id (`ids=a,b,…`, at most 200), e.g. for linked work. */
  @Get("lookup")
  lookup(@Query() query: LookupInitiativesQueryDto) {
    return this.initiatives.lookup(query.ids);
  }

  /** Tags in use, for suggestions (e.g. following a tag). */
  @Get("tags")
  tags() {
    return this.initiatives.tagsInUse();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.initiatives.getOrThrow(id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInitiativeDto) {
    return this.initiatives.create(user, dto);
  }

  /**
   * AI help while writing one: "draft" fills the fields from a rough
   * description, "improve" proposes edits to what's written. Nothing is
   * saved — the dialog shows the suggestions and the author picks.
   */
  @Post("assist")
  @LlmThrottle()
  assist(@CurrentUser() user: AuthenticatedUser, @Body() dto: AssistInitiativeDto) {
    return this.assistant.assist(user, dto);
  }

  /** Bulk create — up to 500 rows, each validated; bad rows are reported, not fatal. */
  @Post("import")
  @BulkThrottle()
  async import(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportInitiativesDto) {
    const result = await this.initiatives.importMany(user, dto.rows);
    await this.audit.record(
      user,
      "initiatives.imported",
      `${user.name} imported ${result.created} initiative${result.created === 1 ? "" : "s"}` +
        (result.errors.length ? ` (${result.errors.length} rows rejected)` : ""),
      {
        targetType: "initiative",
        data: { created: result.created, rejected: result.errors.length },
      },
    );
    return result;
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateInitiativeDto,
  ) {
    return this.initiatives.update(user, id, dto);
  }

  /**
   * Fold this initiative (a confirmed duplicate) into another one: at once
   * if you can edit both, otherwise as a request the target's owners accept
   * (`outcome` says which).
   */
  @Post(":id/merge")
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: MergeInitiativeDto,
  ) {
    return this.merges.merge(user, id, dto.intoId);
  }

  /** Open merge requests from or into this initiative. */
  @Get(":id/merge-requests")
  mergeRequests(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.merges.listFor(user, id);
  }

  @Get(":id/signals")
  listSignals(@Param("id", ParseUUIDPipe) id: string) {
    return this.signals.list(id);
  }

  /** "We need this too" from the caller's team (idempotent; updates the note). */
  @Post(":id/signals")
  addSignal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SignalDto,
  ) {
    return this.signals.add(user, id, dto.note);
  }

  @Delete(":id/signals")
  removeSignal(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.signals.remove(user, id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.initiatives.remove(user, id);
  }
}
