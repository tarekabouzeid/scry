import { Injectable, Logger, ServiceUnavailableException, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as oidc from "openid-client";
import type { OidcClaims } from "./user.service";

export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier: string;
}

/** Endpoints the api calls itself — never the ones a browser is sent to. */
const BACKCHANNEL_ENDPOINTS = [
  "token_endpoint",
  "userinfo_endpoint",
  "jwks_uri",
  "introspection_endpoint",
  "revocation_endpoint",
  "pushed_authorization_request_endpoint",
] as const;

/**
 * Split-horizon IdPs (e.g. Keycloak in the same compose network) publish a
 * browser-facing issuer (http://localhost:8080/...) that the api container
 * can't reach, while the api discovers them at an internal address
 * (http://keycloak:8080/...). Keycloak rewrites some back-channel endpoints
 * for the internal host but not all, so point every server-to-server
 * endpoint at the origin the api actually reached. Browser-facing endpoints and the issuer itself (checked
 * against ID tokens) are left untouched. A no-op when the origins match.
 */
export function withReachableBackchannel(
  metadata: oidc.ServerMetadata,
  discoveryUrl: string,
  logger?: Logger,
): oidc.ServerMetadata {
  const publicOrigin = new URL(metadata.issuer).origin;
  const reachableOrigin = new URL(discoveryUrl).origin;
  if (publicOrigin === reachableOrigin) return metadata;

  const fixed: Record<string, unknown> = { ...metadata };
  const rewritten: string[] = [];
  for (const key of BACKCHANNEL_ENDPOINTS) {
    const value = fixed[key];
    if (typeof value === "string" && value.startsWith(publicOrigin)) {
      fixed[key] = reachableOrigin + value.slice(publicOrigin.length);
      rewritten.push(key);
    }
  }
  if (rewritten.length) {
    logger?.log(
      `OIDC back-channel endpoints routed via ${reachableOrigin}: ${rewritten.join(", ")}`,
    );
  }
  return fixed as oidc.ServerMetadata;
}

/**
 * openid-client insists the discovered issuer equals the URL it was
 * discovered from, which a split-horizon IdP never satisfies. Discovering
 * from the well-known document skips that check, so repeat it here with the
 * origin left out: the issuer must still be the same realm (path).
 */
function discoveryDocumentUrl(issuerUrl: string): URL {
  const url = new URL(issuerUrl);
  url.pathname = url.pathname.replace(/\/$/, "") + "/.well-known/openid-configuration";
  return url;
}

function assertSameIssuerPath(metadata: oidc.ServerMetadata, issuerUrl: string) {
  const path = (u: string) => new URL(u).pathname.replace(/\/$/, "");
  if (path(metadata.issuer) !== path(issuerUrl)) {
    throw new Error(`discovered issuer ${metadata.issuer} does not match ${issuerUrl}`);
  }
}

/**
 * Wraps openid-client for the Authorization Code +
 * PKCE sign-in. Verified against Keycloak; exercise against your own IdP
 * (Okta, Entra ID, Google) before relying on it.
 */
@Injectable()
export class OidcService implements OnModuleInit {
  private readonly logger = new Logger(OidcService.name);
  private client?: oidc.Configuration;
  private discovering?: Promise<oidc.Configuration>;

  constructor(private readonly config: ConfigService) {}

  /**
   * Try discovery at boot, but never fail boot on it: the IdP is often still
   * starting (e.g. Keycloak in the same compose stack) or briefly down.
   * ensureClient() retries on demand until discovery succeeds.
   */
  async onModuleInit() {
    if (!this.config.get<string>("OIDC_ISSUER_URL")) {
      // Auth isn't configured yet in this environment — endpoints that need
      // it will fail loudly rather than crash boot, so the rest of the API
      // (health, docs) stays usable while OIDC is being set up.
      return;
    }
    try {
      await this.ensureClient();
    } catch (err) {
      this.logger.warn(
        `OIDC discovery failed at startup (${(err as Error).message}) — will retry on first login.`,
      );
    }
  }

  private async ensureClient(): Promise<oidc.Configuration> {
    if (this.client) return this.client;
    const issuerUrl = this.config.get<string>("OIDC_ISSUER_URL");
    if (!issuerUrl) {
      throw new ServiceUnavailableException(
        "OIDC is not configured on this deployment (OIDC_ISSUER_URL missing)",
      );
    }
    // Share one in-flight discovery between concurrent callers; clear it on
    // failure so the next request tries again.
    this.discovering ??= this.discover(issuerUrl)
      .then((client) => {
        this.client = client;
        this.logger.log(`OIDC issuer discovered: ${client.serverMetadata().issuer}`);
        return client;
      })
      .finally(() => {
        this.discovering = undefined;
      });
    try {
      return await this.discovering;
    } catch (err) {
      throw new ServiceUnavailableException(
        `Identity provider unreachable at ${issuerUrl}: ${(err as Error).message}`,
      );
    }
  }

  private async discover(issuerUrl: string): Promise<oidc.Configuration> {
    const clientId = this.config.getOrThrow<string>("OIDC_CLIENT_ID");
    const secret = this.config.get<string>("OIDC_CLIENT_SECRET");
    // v5 used client_secret_basic by default; v6 would switch to _post.
    const auth = secret ? oidc.ClientSecretBasic(secret) : oidc.None();
    // Local IdPs (the demo's Keycloak, the e2e stand-in) are plain http.
    const insecure = new URL(issuerUrl).protocol === "http:";
    const discovered = await oidc.discovery(
      discoveryDocumentUrl(issuerUrl),
      clientId,
      undefined,
      auth,
      insecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
    );
    const metadata = discovered.serverMetadata();
    assertSameIssuerPath(metadata, issuerUrl);
    const reachable = withReachableBackchannel(metadata, issuerUrl, this.logger);
    if (reachable === metadata) return discovered;
    const client = new oidc.Configuration(reachable, clientId, undefined, auth);
    if (insecure) oidc.allowInsecureRequests(client);
    return client;
  }

  async buildAuthorizationRequest(): Promise<AuthorizationRequest> {
    const client = await this.ensureClient();
    const state = oidc.randomState();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: this.config.getOrThrow<string>("OIDC_REDIRECT_URI"),
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return { url: url.href, state, codeVerifier };
  }

  async handleCallback(params: {
    callbackUrl: string;
    query: Record<string, string>;
    state: string;
    codeVerifier: string;
  }): Promise<OidcClaims> {
    const client = await this.ensureClient();
    // The token request's redirect_uri is this URL without its query.
    const currentUrl = new URL(params.callbackUrl);
    for (const [key, value] of Object.entries(params.query)) {
      if (typeof value === "string") currentUrl.searchParams.set(key, value);
    }
    const tokens = await oidc.authorizationCodeGrant(client, currentUrl, {
      expectedState: params.state,
      pkceCodeVerifier: params.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("OIDC provider did not return an ID token");
    return this.claimsFromIdToken(claims);
  }

  private claimsFromIdToken(claims: oidc.IDToken): OidcClaims {
    const email = claims.email;
    if (typeof email !== "string") {
      throw new Error("OIDC provider did not return an email claim");
    }
    return {
      sub: String(claims.sub),
      email,
      name: typeof claims.name === "string" ? claims.name : undefined,
      employeeId:
        typeof claims.employee_id === "string"
          ? claims.employee_id
          : typeof claims.employeeId === "string"
            ? claims.employeeId
            : undefined,
    };
  }
}
