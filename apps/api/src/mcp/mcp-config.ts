import type { ConfigService } from "@nestjs/config";

/**
 * The api's own public address, as AI tools reach it: API_PUBLIC_URL, else
 * the one the web app calls (NEXT_PUBLIC_API_URL), else the origin of the
 * OIDC redirect (which is always on the api).
 */
export function publicApiUrl(config: ConfigService): string {
  const explicit =
    config.get<string>("API_PUBLIC_URL") ?? config.get<string>("NEXT_PUBLIC_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const redirect = config.get<string>("OIDC_REDIRECT_URI");
  if (redirect) return new URL(redirect).origin;
  return `http://localhost:${config.get<string>("API_PORT") ?? "3001"}`;
}

/** The MCP endpoint: the OAuth "resource" every access token is bound to. */
export function mcpResource(config: ConfigService): string {
  return `${publicApiUrl(config)}/mcp`;
}

export const MCP_SCOPE = "scry:read";

/**
 * Where an AI tool may be sent back after sign-in (RFC 8252): https, a
 * loopback http address (any port, since native apps pick one at random),
 * or an app's own URI scheme (cursor://, vscode://). Never plain http to
 * another host, and never javascript:, data: or file:.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "https") return true;
  if (scheme === "http") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (["javascript", "data", "file", "vbscript", "blob", "about", "ws", "wss"].includes(scheme)) {
    return false;
  }
  // A private-use scheme: reverse domain or app name, e.g. "cursor", "vscode".
  return /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

function isLoopback(url: URL) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/**
 * Does a redirect_uri in a request match one the client registered? Exactly,
 * except that a loopback address may use any port (RFC 8252 §7.3).
 */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopback(asked)) return false;
  return registered.some((r) => {
    try {
      const known = new URL(r);
      return (
        isLoopback(known) &&
        known.hostname === asked.hostname &&
        known.pathname === asked.pathname &&
        known.search === asked.search
      );
    } catch {
      return false;
    }
  });
}
