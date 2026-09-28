import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { oauthClients, oauthCodes, oauthGrants, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "../auth/types";
import {
  MCP_SCOPE,
  isAllowedRedirectUri,
  mcpResource,
  publicApiUrl,
  redirectMatches,
} from "./mcp-config";

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_DAYS = 30;
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_TTL_SECONDS = 10 * 60;

/** An OAuth error, shaped as RFC 6749 wants it. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

/** A validated authorization request, carried (signed) to the consent page and back. */
interface PendingRequest {
  cid: string;
  ru: string;
  cc: string;
  st?: string;
  sc: string;
  rs?: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (prefix: string) => prefix + randomBytes(32).toString("base64url");

/**
 * Scry as an OAuth 2.1 authorization server for its own MCP endpoint.
 * People sign in with Scry's usual login (the company IdP), approve the AI
 * tool on a consent page, and the tool gets a short-lived, read-only access
 * token bound to /mcp, plus a rotating refresh token. Public clients only,
 * PKCE (S256) always.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  // Keys derived from SESSION_SECRET, one per purpose, so an MCP access
  // token can never pass as a session (or the other way round).
  private key(purpose: string) {
    return createHash("sha256")
      .update(`scry:${purpose}:${this.config.getOrThrow<string>("SESSION_SECRET")}`)
      .digest();
  }

  get issuer() {
    return publicApiUrl(this.config);
  }

  metadata() {
    const base = this.issuer;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [MCP_SCOPE],
      authorization_response_iss_parameter_supported: true,
    };
  }

  resourceMetadata() {
    return {
      resource: mcpResource(this.config),
      authorization_servers: [this.issuer],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Scry (read-only)",
    };
  }

  // --------------------------------------------------------- registration

  /** Dynamic client registration (RFC 7591), public clients only. */
  async register(body: Record<string, unknown>) {
    const uris = body.redirect_uris;
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > 10 ||
      !uris.every((u) => typeof u === "string" && u.length <= 2000 && isAllowedRedirectUri(u))
    ) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "redirect_uris must be 1–10 https, loopback http or app-scheme URLs",
      );
    }
    const method = body.token_endpoint_auth_method ?? "none";
    if (method !== "none") {
      throw new OAuthError(
        "invalid_client_metadata",
        "Only public clients (token_endpoint_auth_method none) with PKCE are supported",
      );
    }
    const rawName = typeof body.client_name === "string" ? body.client_name.trim() : "";
    const name = (rawName || "AI tool").slice(0, 100);
    const clientId = `scry_client_${randomBytes(16).toString("base64url")}`;
    const [row] = await this.db
      .insert(oauthClients)
      .values({ clientId, name, redirectUris: uris as string[] })
      .returning();
    return {
      client_id: row!.clientId,
      client_name: row!.name,
      client_id_issued_at: Math.floor(row!.createdAt.getTime() / 1000),
      redirect_uris: row!.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: MCP_SCOPE,
    };
  }

  private async client(clientId: string | undefined) {
    if (!clientId) return undefined;
    const [row] = await this.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    return row;
  }

  // ----------------------------------------------------------- authorize

  /**
   * Check an authorization request. Problems with the client or its
   * redirect URI can't be sent back to it (we'd be redirecting somewhere
   * unverified), so they throw; everything else becomes an error redirect.
   * On success, returns a signed request for the consent page.
   */
  async startAuthorization(
    p: AuthorizeParams,
  ): Promise<{ request: string } | { redirect: string }> {
    const client = await this.client(p.client_id);
    if (!client) throw new OAuthError("invalid_client", "Unknown client_id");
    if (!p.redirect_uri || !redirectMatches(client.redirectUris, p.redirect_uri)) {
      throw new OAuthError("invalid_request", "redirect_uri isn't registered for this client");
    }
    const fail = (error: string, description: string) => ({
      redirect: this.redirectWith(p.redirect_uri!, {
        error,
        error_description: description,
        state: p.state,
      }),
    });
    if (p.response_type !== "code") {
      return fail("unsupported_response_type", "Only response_type=code is supported");
    }
    if (!p.code_challenge || p.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_challenge)) {
      return fail("invalid_request", "code_challenge isn't a valid S256 challenge");
    }
    const scopes = (p.scope ?? MCP_SCOPE).split(/\s+/).filter(Boolean);
    // Tools that ask for nothing in particular, or for MCP_SCOPE, get read access.
    if (scopes.some((s) => s !== MCP_SCOPE)) {
      return fail("invalid_scope", `Scry only offers ${MCP_SCOPE}`);
    }
    if (p.resource && p.resource.replace(/\/+$/, "") !== mcpResource(this.config)) {
      return fail("invalid_target", `resource must be ${mcpResource(this.config)}`);
    }
    const pending: PendingRequest = {
      cid: client.clientId,
      ru: p.redirect_uri,
      cc: p.code_challenge,
      st: p.state,
      sc: MCP_SCOPE,
      rs: p.resource,
    };
    const request = await new SignJWT({ ...pending })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${REQUEST_TTL_SECONDS}s`)
      .sign(this.key("oauth-request"));
    return { request };
  }

  private async readRequest(request: string): Promise<PendingRequest> {
    try {
      const { payload } = await jwtVerify(request, this.key("oauth-request"));
      return payload as unknown as PendingRequest;
    } catch {
      throw new OAuthError(
        "invalid_request",
        "This sign-in request has expired. Start again from your AI tool.",
      );
    }
  }

  /** What the consent page shows: which tool, and where it goes back to. */
  async describeRequest(request: string) {
    const pending = await this.readRequest(request);
    const client = await this.client(pending.cid);
    if (!client) throw new OAuthError("invalid_client", "This AI tool is no longer registered");
    let returnsTo = pending.ru;
    try {
      const url = new URL(pending.ru);
      returnsTo = url.protocol.startsWith("http") ? url.host : `${url.protocol}//`;
    } catch {
      // keep the raw value
    }
    return { clientName: client.name, returnsTo, scope: pending.sc };
  }

  /** The person answered the consent page: back to the tool with a code, or with "denied". */
  async decide(request: string, user: AuthenticatedUser, allow: boolean): Promise<string> {
    const pending = await this.readRequest(request);
    const client = await this.client(pending.cid);
    if (!client) throw new OAuthError("invalid_client", "This AI tool is no longer registered");
    if (!allow) {
      return this.redirectWith(pending.ru, {
        error: "access_denied",
        error_description: "The person declined",
        state: pending.st,
      });
    }
    const code = token("scry_code_");
    await this.db.insert(oauthCodes).values({
      codeHash: hash(code),
      clientId: client.id,
      userId: user.id,
      redirectUri: pending.ru,
      codeChallenge: pending.cc,
      scope: pending.sc,
      resource: pending.rs ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return this.redirectWith(pending.ru, { code, state: pending.st });
  }

  private redirectWith(uri: string, params: Record<string, string | undefined>) {
    const url = new URL(uri);
    for (const [k, v] of Object.entries({ ...params, iss: this.issuer })) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  // --------------------------------------------------------------- token

  async exchange(body: Record<string, unknown>) {
    const grantType = body.grant_type;
    if (grantType === "authorization_code") return this.exchangeCode(body);
    if (grantType === "refresh_token") return this.refresh(body);
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  private async exchangeCode(body: Record<string, unknown>) {
    const code = typeof body.code === "string" ? body.code : "";
    const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    const client = await this.client(
      typeof body.client_id === "string" ? body.client_id : undefined,
    );
    if (!client) throw new OAuthError("invalid_client", "Unknown client_id", 401);
    // Single use: whoever marks it used first wins.
    const [row] = await this.db
      .update(oauthCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(oauthCodes.codeHash, hash(code)), isNull(oauthCodes.usedAt)))
      .returning();
    if (!row || row.clientId !== client.id || row.expiresAt.getTime() < Date.now()) {
      throw new OAuthError("invalid_grant", "The code is invalid, used or expired");
    }
    if (body.redirect_uri !== undefined && body.redirect_uri !== row.redirectUri) {
      throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization");
    }
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const a = Buffer.from(challenge);
    const b = Buffer.from(row.codeChallenge);
    if (!verifier || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge");
    }
    const refreshToken = token("scry_refresh_");
    const [grant] = await this.db
      .insert(oauthGrants)
      .values({
        clientId: client.id,
        userId: row.userId,
        scope: row.scope,
        refreshTokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
      })
      .returning();
    return this.tokenResponse(grant!.id, row.userId, row.scope, refreshToken);
  }

  private async refresh(body: Record<string, unknown>) {
    const raw = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const client = await this.client(
      typeof body.client_id === "string" ? body.client_id : undefined,
    );
    if (!client) throw new OAuthError("invalid_client", "Unknown client_id", 401);
    const next = token("scry_refresh_");
    // Rotate atomically: the old refresh token works exactly once.
    const [grant] = await this.db
      .update(oauthGrants)
      .set({
        refreshTokenHash: hash(next),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
      })
      .where(
        and(
          eq(oauthGrants.refreshTokenHash, hash(raw)),
          eq(oauthGrants.clientId, client.id),
          isNull(oauthGrants.revokedAt),
          gt(oauthGrants.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!grant) throw new OAuthError("invalid_grant", "The refresh token is invalid or revoked");
    return this.tokenResponse(grant.id, grant.userId, grant.scope, next);
  }

  private async tokenResponse(grantId: string, userId: string, scope: string, refresh: string) {
    const access = await new SignJWT({ scope, gid: grantId })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setIssuer(this.issuer)
      .setAudience(mcpResource(this.config))
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key("mcp-access"));
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope,
    };
  }

  /** RFC 7009: revoking a refresh token ends the whole grant. Always succeeds. */
  async revokeToken(body: Record<string, unknown>) {
    const raw = typeof body.token === "string" ? body.token : "";
    if (!raw) return;
    await this.db
      .update(oauthGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthGrants.refreshTokenHash, hash(raw)), isNull(oauthGrants.revokedAt)));
  }

  // ------------------------------------------------------ using a token

  /** An MCP access token's person and grant, if it's valid and not revoked. */
  async verifyAccessToken(raw: string) {
    let payload;
    try {
      ({ payload } = await jwtVerify(raw, this.key("mcp-access"), {
        issuer: this.issuer,
        audience: mcpResource(this.config),
        typ: "at+jwt",
      }));
    } catch {
      return null;
    }
    if (typeof payload.sub !== "string" || typeof payload.gid !== "string") return null;
    const [row] = await this.db
      .select({ grant: oauthGrants, clientName: oauthClients.name, user: users })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .innerJoin(users, eq(users.id, oauthGrants.userId))
      .where(eq(oauthGrants.id, payload.gid));
    if (!row || row.grant.revokedAt || row.grant.userId !== payload.sub) return null;
    // Last used, at most once a minute (fire-and-forget).
    if (!row.grant.lastUsedAt || Date.now() - row.grant.lastUsedAt.getTime() > 60_000) {
      this.db
        .update(oauthGrants)
        .set({ lastUsedAt: new Date() })
        .where(eq(oauthGrants.id, row.grant.id))
        .catch((err: Error) => this.logger.warn(`Grant use not recorded: ${err.message}`));
    }
    return { user: row.user, grantId: row.grant.id, clientName: row.clientName };
  }

  // -------------------------------------------------- people and admins

  /** AI tools connected as this person (live grants), newest first. */
  async grantsFor(userId: string) {
    return this.db
      .select({
        id: oauthGrants.id,
        client: oauthClients.name,
        createdAt: oauthGrants.createdAt,
        lastUsedAt: oauthGrants.lastUsedAt,
      })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(
        and(
          eq(oauthGrants.userId, userId),
          isNull(oauthGrants.revokedAt),
          gt(oauthGrants.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(oauthGrants.createdAt));
  }

  /** Revoke one grant (its owner) or all of a person's (an admin). Returns how many. */
  async revokeGrants(by: AuthenticatedUser, where: { userId: string; grantId?: string }) {
    const rows = await this.db
      .update(oauthGrants)
      .set({ revokedAt: new Date(), revokedBy: by.id })
      .where(
        and(
          eq(oauthGrants.userId, where.userId),
          where.grantId ? eq(oauthGrants.id, where.grantId) : undefined,
          isNull(oauthGrants.revokedAt),
        ),
      )
      .returning({ id: oauthGrants.id });
    return rows.length;
  }
}
