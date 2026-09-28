/**
 * Optional guard on where Scry may send AI traffic (LLM_ALLOWED_HOSTS).
 * Admins can point the model endpoint and token URL anywhere; in locked-down
 * deployments that's a way to probe internal services from the api, so
 * operators can pin the allowed hosts. Set in the environment on purpose —
 * an admin account (or a stolen admin session) can't widen it.
 *
 * Entries are hostnames, optionally with a port, and may start with "*."
 * for any subdomain: "litellm", "litellm:4000", "*.openai.azure.com".
 */
export function parseAllowedHosts(raw: string | undefined): string[] | null {
  const entries = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? entries : null;
}

export function isHostAllowed(url: string, allowed: string[] | null): boolean {
  if (!allowed) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return allowed.some((entry) => {
    const [pattern, entryPort] = entry.split(":");
    if (entryPort && entryPort !== port) return false;
    if (!pattern) return false;
    return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;
  });
}

/** The URLs a configuration would send traffic to. */
export function outboundUrls(settings: {
  connection: { baseUrl: string; auth: { mode: string; tokenUrl: string } };
}): string[] {
  const urls = [settings.connection.baseUrl];
  if (settings.connection.auth.mode === "oauth2_client_credentials") {
    urls.push(settings.connection.auth.tokenUrl);
  }
  return urls.filter(Boolean);
}
