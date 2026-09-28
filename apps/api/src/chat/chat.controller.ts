import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  Res,
  HttpException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { CreateInitiativeDto } from "../initiatives/dto/create-initiative.dto";
import { ChatService, type ChatStreamEvent } from "./chat.service";
import type { Response } from "express";
import { LlmThrottle } from "../common/throttle";
import { PostMessageDto } from "./dto/post-message.dto";
import { DecideEvidenceDto } from "./dto/decide-evidence.dto";

@ApiTags("chat")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller("chat/sessions")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.listSessions(user.id);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.chat.getSession(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.chat.createSession(user.id);
  }

  @Post(":id/messages")
  @LlmThrottle()
  postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.chat.postMessage(user, id, dto.content);
  }

  /**
   * Same as POST :id/messages, but the answer arrives as it's written:
   * newline-delimited JSON events — context (classification), delta (text),
   * then done (the saved message, as the plain endpoint returns it) or error.
   */
  @Post(":id/messages/stream")
  @LlmThrottle()
  async streamMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PostMessageDto,
    @Res() res: Response,
  ) {
    let started = false;
    const emit = (event: ChatStreamEvent) => {
      if (!started) {
        started = true;
        res.status(200);
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        // Stop proxies (nginx) buffering the stream into one response.
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
      }
      res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await this.chat.streamMessage(user, id, dto.content, emit);
      res.end();
    } catch (err) {
      // Before the first event nothing is sent yet: let Nest answer with the
      // usual status and message (404, 503 "AI isn't set up", …).
      if (!started) throw err;
      const message =
        err instanceof HttpException ? err.message : "Scry couldn't finish this answer.";
      emit({ type: "error", message });
      res.end();
    }
  }

  /** LLM-drafted title/summary/tags/tier from this chat, to pre-fill the register form. */
  @Post(":id/draft")
  @LlmThrottle()
  draft(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.chat.draftInitiative(user, id);
  }

  @Post(":id/register")
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeDto,
  ) {
    return this.chat.register(user, id, dto);
  }

  @Patch(":id/messages/:messageId/evidence")
  decideEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
    @Body() dto: DecideEvidenceDto,
  ) {
    return this.chat.decideEvidence(
      user,
      id,
      messageId,
      dto.initiativeId,
      dto.decision,
      dto.edgeType,
    );
  }
}
