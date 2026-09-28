import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { AuthThrottle } from "../common/throttle";
import { OAuthError, OAuthService, type AuthorizeParams } from "./oauth.service";
import { McpSettingsService } from "./mcp-settings.service";

function sendOAuthError(res: Response, err: unknown) {
  if (!(err instanceof OAuthError)) throw err;
  res
    .status(err.status)
    .set("Cache-Control", "no-store")
    .json({ error: err.error, error_description: err.description });
}

/**
 * Scry as the OAuth authorization server for its MCP endpoint: discovery
 * metadata, client registration, the authorize step (which hands over to
 * the web app's consent page) and the token endpoint.
 */
@ApiExcludeController()
@Controller()
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly settings: McpSettingsService,
    private readonly config: ConfigService,
  ) {}

  @Get(".well-known/oauth-authorization-server")
  metadata() {
    return this.oauth.metadata();
  }

  // Clients look for the resource metadata at the root and under the path.
  @Get([".well-known/oauth-protected-resource", ".well-known/oauth-protected-resource/mcp"])
  resourceMetadata() {
    return this.oauth.resourceMetadata();
  }

  @Post("oauth/register")
  @AuthThrottle()
  async register(@Body() body: Record<string, unknown>, @Res() res: Response) {
    try {
      res
        .status(201)
        .set("Cache-Control", "no-store")
        .json(await this.oauth.register(body ?? {}));
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  /**
   * Checks the request, then sends the browser to the web app's consent
   * page (which signs the person in first if needed). Client and redirect
   * problems are shown here as plain text: redirecting to an unverified
   * address would make this an open redirect.
   */
  @Get("oauth/authorize")
  @AuthThrottle()
  async authorize(@Query() query: AuthorizeParams, @Res() res: Response) {
    let outcome;
    try {
      outcome = await this.oauth.startAuthorization(query);
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      res.status(400).type("text/plain").send(`Can't connect this AI tool: ${err.description}`);
      return;
    }
    if ("redirect" in outcome) {
      res.redirect(outcome.redirect);
      return;
    }
    const web = this.config.getOrThrow<string>("WEB_ORIGIN");
    res.redirect(`${web}/connect?request=${encodeURIComponent(outcome.request)}`);
  }

  /** For the consent page: which tool is asking, and whether MCP is on. */
  @Get("oauth/request")
  @UseGuards(SessionAuthGuard)
  async describe(@Query("request") request: string, @Res() res: Response) {
    try {
      const described = await this.oauth.describeRequest(request ?? "");
      res.json({ ...described, enabled: await this.settings.enabled() });
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  /**
   * The consent page's answer. JSON only (so a cross-site form can't post
   * it), and the session cookie is SameSite=Lax (so it isn't sent on a
   * cross-site POST anyway). Returns where to send the browser.
   */
  @Post("oauth/decision")
  @UseGuards(SessionAuthGuard)
  @AuthThrottle()
  async decision(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const request = typeof body?.request === "string" ? body.request : "";
    const allow = body?.allow === true;
    try {
      if (allow && !(await this.settings.enabled())) {
        throw new OAuthError(
          "access_denied",
          "An admin hasn't turned on connecting AI tools to Scry",
          403,
        );
      }
      res.status(200).json({ redirect: await this.oauth.decide(request, user, allow) });
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  @Post("oauth/token")
  @AuthThrottle()
  async token(@Body() body: Record<string, unknown>, @Res() res: Response) {
    try {
      const issued = await this.oauth.exchange(body ?? {});
      // RFC 6749 §5.1: 200, never cached.
      res.status(200).set("Cache-Control", "no-store").set("Pragma", "no-cache").json(issued);
    } catch (err) {
      sendOAuthError(res, err);
    }
  }

  @Post("oauth/revoke")
  @HttpCode(200)
  @AuthThrottle()
  async revoke(@Body() body: Record<string, unknown>) {
    await this.oauth.revokeToken(body ?? {});
    return {};
  }
}
