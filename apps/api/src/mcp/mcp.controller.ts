import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { IsBoolean } from "class-validator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { PatService } from "../auth/pat.service";
import { UserService } from "../auth/user.service";
import { AuditService } from "../audit/audit.service";
import { SearchThrottle } from "../common/throttle";
import { SUPPORTED_PROTOCOL_VERSIONS, handleBody, PARSE_ERROR } from "./mcp-protocol";
import { SERVER_INSTRUCTIONS, TOOLS } from "./mcp-tools";
import { McpToolsService } from "./mcp-tools.service";
import { McpSettingsService } from "./mcp-settings.service";
import { OAuthService } from "./oauth.service";
import { mcpResource, publicApiUrl } from "./mcp-config";

class McpSwitchDto {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * The read-only MCP server: AI assistants and coding agents ask Scry as the
 * person who connected them. Streamable HTTP, stateless, JSON responses.
 */
@ApiTags("mcp")
@Controller()
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly tools: McpToolsService,
    private readonly settings: McpSettingsService,
    private readonly oauth: OAuthService,
    private readonly pats: PatService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Who's calling: an OAuth access token for /mcp, or a personal access token. */
  private async caller(req: Request) {
    const header = req.headers.authorization;
    const raw = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!raw) return null;
    if (raw.startsWith("scry_pat_")) {
      const pat = await this.pats.resolve(raw);
      if (!pat) return null;
      return {
        user: this.users.toAuthenticatedUser(pat.user),
        client: pat.name ?? "API token",
        via: "token" as const,
        grantId: null,
      };
    }
    const found = await this.oauth.verifyAccessToken(raw);
    if (!found) return null;
    return {
      user: this.users.toAuthenticatedUser(found.user),
      client: found.clientName,
      via: "oauth" as const,
      grantId: found.grantId,
    };
  }

  private unauthorized(res: Response, invalid: boolean) {
    const metadata = `${publicApiUrl(this.config)}/.well-known/oauth-protected-resource/mcp`;
    res
      .status(401)
      .set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${metadata}"${invalid ? ', error="invalid_token"' : ""}`,
      )
      .json({
        error: invalid ? "invalid_token" : "unauthorized",
        resource: mcpResource(this.config),
      });
  }

  @Post("mcp")
  @HttpCode(200)
  @SearchThrottle()
  @ApiExcludeEndpoint()
  async mcp(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    // DNS rebinding: a browser page elsewhere must not drive this endpoint.
    const origin = req.headers.origin;
    if (origin && origin !== this.config.get<string>("WEB_ORIGIN")) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    const version = req.headers["mcp-protocol-version"];
    if (
      typeof version === "string" &&
      !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)
    ) {
      res.status(400).json({ error: `Unsupported MCP-Protocol-Version: ${version}` });
      return;
    }
    const caller = await this.caller(req);
    if (!caller) {
      this.unauthorized(res, !!req.headers.authorization);
      return;
    }
    if (!(await this.settings.enabled())) {
      res.status(403).json({
        error: "mcp_disabled",
        error_description: "An admin hasn't turned on connecting AI tools to Scry.",
      });
      return;
    }
    if (body === undefined || body === null || typeof body !== "object") {
      res.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: PARSE_ERROR, message: "Expected a JSON-RPC body" },
      });
      return;
    }
    const answer = await handleBody(body, {
      name: "scry",
      title: "Scry",
      version: "0.1.0",
      instructions: SERVER_INSTRUCTIONS,
      tools: TOOLS,
      call: (name, args) => this.tools.call(caller.user, name, args),
      onCall: ({ tool, args, ids, ok }) =>
        this.settings.record({
          userId: caller.user.id,
          client: caller.client,
          via: caller.via,
          grantId: caller.grantId,
          tool,
          input: args,
          resultIds: ids,
          ok,
        }),
      onError: (err) => this.logger.warn(`MCP tool failed: ${(err as Error).message}`),
    });
    if (answer === null) {
      res.status(202).end();
      return;
    }
    res.json(answer);
  }

  /** No server-initiated stream and no sessions: only POST. */
  @All("mcp")
  @ApiExcludeEndpoint()
  notAllowed(@Res() res: Response) {
    res.status(405).set("Allow", "POST").json({ error: "Use POST" });
  }

  // ------------------------------------------------ the person's own tools

  /** Whether MCP is on, where it is, and the AI tools connected as you. */
  @Get("mcp-connections")
  @UseGuards(SessionAuthGuard)
  async myConnections(@CurrentUser() user: AuthenticatedUser) {
    return {
      enabled: await this.settings.enabled(),
      url: mcpResource(this.config),
      connections: await this.oauth.grantsFor(user.id),
    };
  }

  @Delete("mcp-connections/:id")
  @UseGuards(SessionAuthGuard)
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseUUIDPipe) id: string) {
    if (!(await this.oauth.revokeGrants(user, { userId: user.id, grantId: id }))) {
      throw new NotFoundException("Connection not found");
    }
  }

  // ---------------------------------------------------------------- admin

  @Get("admin/mcp")
  @UseGuards(SessionAuthGuard, AdminGuard)
  async adminSettings() {
    return {
      enabled: await this.settings.enabled(),
      url: mcpResource(this.config),
      retentionDays: this.settings.retentionDays,
      people: await this.settings.people(),
    };
  }

  @Put("admin/mcp")
  @UseGuards(SessionAuthGuard, AdminGuard)
  setEnabled(@CurrentUser() user: AuthenticatedUser, @Body() dto: McpSwitchDto) {
    return this.settings.setEnabled(user, dto.enabled);
  }

  @Get("admin/mcp/calls")
  @UseGuards(SessionAuthGuard, AdminGuard)
  calls(@Query("userId") userId?: string, @Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.settings.recentCalls({ userId: userId || undefined, limit: n });
  }

  /** Disconnect every AI tool a person connected (their tokens are separate). */
  @Post("admin/mcp/people/:userId/revoke")
  @UseGuards(SessionAuthGuard, AdminGuard)
  async revokePerson(
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException("Person not found");
    const revoked = await this.oauth.revokeGrants(user, { userId });
    await this.audit.record(
      user,
      "mcp.connections_revoked",
      `${user.name} disconnected ${target.name}'s AI tools (${revoked})`,
      { targetType: "user", targetId: userId, data: { revoked } },
    );
    return { revoked };
  }
}
