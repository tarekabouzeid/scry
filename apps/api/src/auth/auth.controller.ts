import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { OidcService } from "./oidc.service";
import { SessionService } from "./session.service";
import { UserService } from "./user.service";
import { SessionAuthGuard } from "./guards/session-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { AuthenticatedUser } from "./types";
import { AuthThrottle } from "../common/throttle";

const OIDC_TRANSACTION_COOKIE = "scry_oidc_txn";

/**
 * Error pages for the browser-facing auth redirects. Always a fixed message,
 * always text/plain: IdP / openid-client errors can echo attacker-controlled
 * query parameters (e.g. "state mismatch … got: <payload>"), and reflecting
 * them as HTML would be XSS on the api origin. Details go to the server log.
 */
function sendAuthError(res: Response, status: number, message: string) {
  res.status(status).type("text/plain").send(message);
}

/**
 * Where to land after sign-in: a path in the web app (e.g. the consent page
 * an AI tool sent someone to). Only same-origin paths, never "//host" or
 * "/\\host", so this can't become an open redirect.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4000) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  try {
    const url = new URL(raw, "http://scry.invalid");
    if (url.origin !== "http://scry.invalid") return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly sessions: SessionService,
    private readonly users: UserService,
    private readonly config: ConfigService,
  ) {}

  @Get("login")
  @AuthThrottle()
  @ApiExcludeEndpoint()
  async login(@Res() res: Response, @Query("returnTo") returnTo?: string) {
    const { url, state, codeVerifier } = await this.oidc.buildAuthorizationRequest();
    const txn = Buffer.from(
      JSON.stringify({ state, codeVerifier, returnTo: safeReturnPath(returnTo) }),
    ).toString("base64url");
    res.cookie(OIDC_TRANSACTION_COOKIE, txn, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.get<string>("NODE_ENV") === "production",
      path: "/",
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(url);
  }

  @Get("callback")
  @AuthThrottle()
  @ApiExcludeEndpoint()
  async callback(@Req() req: Request, @Res() res: Response) {
    const txnCookie = req.cookies?.[OIDC_TRANSACTION_COOKIE];
    if (!txnCookie) {
      sendAuthError(res, 400, "Sign-in expired — go back and sign in again.");
      return;
    }
    // The transaction is single-use whatever happens next.
    res.clearCookie(OIDC_TRANSACTION_COOKIE, { path: "/" });

    let txn: { state?: unknown; codeVerifier?: unknown; returnTo?: unknown };
    try {
      txn = JSON.parse(Buffer.from(txnCookie, "base64url").toString());
    } catch {
      sendAuthError(res, 400, "Sign-in failed — go back and sign in again.");
      return;
    }
    if (typeof txn.state !== "string" || typeof txn.codeVerifier !== "string") {
      sendAuthError(res, 400, "Sign-in failed — go back and sign in again.");
      return;
    }

    const redirectUri = this.config.getOrThrow<string>("OIDC_REDIRECT_URI");
    let claims;
    try {
      claims = await this.oidc.handleCallback({
        callbackUrl: redirectUri,
        query: req.query as Record<string, string>,
        state: txn.state,
        codeVerifier: txn.codeVerifier,
      });
    } catch (err) {
      // IdP-side failures (user cancelled, state mismatch, expired code) are
      // client errors, not server crashes — but never echo the error text.
      const message = err instanceof Error ? err.message : "unknown error";
      this.logger.warn(`OIDC callback failed: ${message}`);
      sendAuthError(res, 401, "Sign-in failed — go back and sign in again.");
      return;
    }

    const user = await this.users.upsertFromOidcClaims(claims);
    const token = await this.sessions.sign({ sub: user.id, role: user.role });

    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());

    const webOrigin = this.config.getOrThrow<string>("WEB_ORIGIN");
    res.redirect(webOrigin + (safeReturnPath(txn.returnTo) ?? ""));
  }

  @Get("logout")
  @ApiExcludeEndpoint()
  logout(@Res() res: Response) {
    res.clearCookie(this.sessions.cookieName, { path: "/" });
    const webOrigin = this.config.getOrThrow<string>("WEB_ORIGIN");
    res.redirect(webOrigin);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiOkResponse({ description: "The currently authenticated user." })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  /** The product tour was finished or skipped; don't start it automatically again. */
  @Post("me/tour-seen")
  @UseGuards(SessionAuthGuard)
  @HttpCode(204)
  async tourSeen(@CurrentUser() user: AuthenticatedUser) {
    await this.users.markTourSeen(user.id);
  }
}
