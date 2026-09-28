import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { SessionAuthGuard } from "./guards/session-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { PatService } from "./pat.service";
import { AuthThrottle } from "../common/throttle";
import type { AuthenticatedUser } from "./types";
import { AuditService } from "../audit/audit.service";

class CreatePatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: "Omit for a token that never expires." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  @ApiPropertyOptional({
    enum: ["read", "write"],
    description: "read (the default): GET only. write: acts fully as you.",
  })
  @IsOptional()
  @IsIn(["read", "write"])
  scope?: "read" | "write";
}

/**
 * Personal access tokens: a signed-in person mints a token for scripts and
 * AI tools (MCP) to act as them. Read-only unless they ask for write.
 */
@ApiTags("auth")
@UseGuards(SessionAuthGuard)
@Controller("auth/pat")
export class PatController {
  constructor(
    private readonly pats: PatService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.pats.list(user.id);
  }

  @Post()
  @AuthThrottle()
  @ApiCreatedResponse({ description: "A newly issued personal access token (shown once)." })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreatePatDto) {
    const scope = body?.scope ?? "read";
    const token = await this.pats.issue(user.id, body?.name, body?.expiresInDays, scope);
    await this.audit.record(
      user,
      "token.created",
      `${user.name} created a ${scope === "read" ? "read-only" : "read and write"} API token${
        body?.name ? ` "${body.name}"` : ""
      }`,
      {
        targetType: "user",
        targetId: user.id,
        data: { name: body?.name ?? null, expiresInDays: body?.expiresInDays ?? null, scope },
      },
    );
    return { token };
  }

  @Delete(":id")
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    if (!(await this.pats.revoke(user.id, id))) throw new NotFoundException("Token not found");
    await this.audit.record(user, "token.revoked", `${user.name} revoked an API token`, {
      targetType: "token",
      targetId: id,
    });
  }
}
