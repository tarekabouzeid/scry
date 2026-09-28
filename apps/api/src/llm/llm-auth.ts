import { randomUUID } from "node:crypto";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";
import type { LlmSettings } from "./llm-settings.schema";

export interface SigningKey {
  keyId: string;
  privateJwk: JWK;
  publicJwk: JWK;
  createdAt: string;
}

/** Decrypted secrets, as stored (sealed) in llm_settings.secrets. */
export interface LlmSecrets {
  apiKey?: string;
  clientSecret?: string;
  signingKey?: SigningKey;
  /** Kept in the JWKS after a rotation so tokens already issued still verify. */
  previousSigningKey?: SigningKey;
}

/**
 * Gateways cache JWKS (LiteLLM for minutes), so a rotated key is published
 * straight away but only used for signing after this delay — by then every
 * gateway has seen it. Until then the previous key keeps signing.
 */
export const KEY_ACTIVATION_DELAY_MS = 10 * 60_000;

/** The key to sign with now (see KEY_ACTIVATION_DELAY_MS). */
export function activeSigningKey(secrets: LlmSecrets, now = Date.now()): SigningKey | undefined {
  const { signingKey, previousSigningKey } = secrets;
  if (!signingKey || !previousSigningKey) return signingKey;
  const activatesAt = Date.parse(signingKey.createdAt) + KEY_ACTIVATION_DELAY_MS;
  return now >= activatesAt ? signingKey : previousSigningKey;
}

export async function createSigningKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const keyId = await calculateJwkThumbprint(publicJwk);
  return {
    keyId,
    privateJwk: { ...(await exportJWK(privateKey)), kid: keyId, alg: "RS256" },
    publicJwk: { ...publicJwk, kid: keyId, alg: "RS256", use: "sig" },
    createdAt: new Date().toISOString(),
  };
}

/** Produces the auth headers for each request to the model endpoint. */
export interface CredentialProvider {
  headers(): Promise<Record<string, string>>;
}

const EXPIRY_MARGIN_MS = 30_000;

/** Caches a token until shortly before it expires; concurrent callers share one fetch. */
function cachedToken(fetchToken: () => Promise<{ token: string; expiresAt: number }>) {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<{ token: string; expiresAt: number }> | null = null;
  return async () => {
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.token;
    inFlight ??= fetchToken().finally(() => (inFlight = null));
    cached = await inFlight;
    return cached.token;
  };
}

export function credentialProvider(
  settings: LlmSettings,
  secrets: LlmSecrets,
  fetchImpl: typeof fetch = fetch,
): CredentialProvider {
  const auth = settings.connection.auth;

  switch (auth.mode) {
    case "none":
      return { headers: async () => ({}) };

    case "api_key": {
      const key = secrets.apiKey;
      if (!key) throw new Error("No API key is stored — enter one in Admin → AI & models");
      const isAuthorization = auth.headerName.toLowerCase() === "authorization";
      const value = isAuthorization && !/^bearer\s/i.test(key) ? `Bearer ${key}` : key;
      return {
        headers: async () => ({ [isAuthorization ? "authorization" : auth.headerName]: value }),
      };
    }

    case "oauth2_client_credentials": {
      const secret = secrets.clientSecret;
      if (!secret) throw new Error("No client secret is stored — enter one in Admin → AI & models");
      const token = cachedToken(async () => {
        const body = new URLSearchParams({ grant_type: "client_credentials" });
        if (auth.scope) body.set("scope", auth.scope);
        if (auth.audience) body.set("audience", auth.audience);
        const headers: Record<string, string> = {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        };
        if (auth.clientAuthMethod === "client_secret_basic") {
          // RFC 6749 §2.3.1: form-encode each part before joining.
          const id = encodeURIComponent(auth.clientId);
          const pw = encodeURIComponent(secret);
          headers.authorization = `Basic ${Buffer.from(`${id}:${pw}`).toString("base64")}`;
        } else {
          body.set("client_id", auth.clientId);
          body.set("client_secret", secret);
        }
        const res = await fetchImpl(auth.tokenUrl, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(15_000),
        });
        const json = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
          error?: string;
          error_description?: string;
        };
        if (!res.ok || !json.access_token) {
          const reason = json.error_description ?? json.error ?? `HTTP ${res.status}`;
          throw new Error(`The token endpoint refused the client credentials: ${reason}`);
        }
        const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) : 300;
        return { token: json.access_token, expiresAt: Date.now() + ttl * 1000 };
      });
      return { headers: async () => ({ authorization: `Bearer ${await token()}` }) };
    }

    case "signed_jwt": {
      if (!secrets.signingKey) {
        throw new Error("No signing key yet — generate one in Admin → AI & models");
      }
      const token = cachedToken(async () => {
        const key = activeSigningKey(secrets)!;
        const privateKey = importJWK(key.privateJwk, "RS256");
        const now = Math.floor(Date.now() / 1000);
        const jwt = await new SignJWT({ ...auth.extraClaims })
          .setProtectedHeader({ alg: "RS256", kid: key.keyId, typ: "JWT" })
          .setIssuer(auth.issuer)
          .setAudience(auth.audience)
          .setSubject(auth.subject)
          .setIssuedAt(now)
          .setExpirationTime(now + auth.ttlSeconds)
          .setJti(randomUUID())
          .sign(await privateKey);
        return { token: jwt, expiresAt: (now + auth.ttlSeconds) * 1000 };
      });
      return { headers: async () => ({ authorization: `Bearer ${await token()}` }) };
    }
  }
}

/**
 * A fetch for the AI SDK: adds auth and custom headers to every call and
 * enforces the configured timeout. Replaces whatever Authorization header
 * the SDK set from its placeholder API key.
 */
export function authenticatedFetch(
  settings: LlmSettings,
  credentials: CredentialProvider,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    for (const [name, value] of Object.entries(settings.connection.headers)) {
      headers.set(name, value);
    }
    for (const [name, value] of Object.entries(await credentials.headers())) {
      headers.set(name, value);
    }
    const timeout = AbortSignal.timeout(settings.connection.timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchImpl(input, { ...init, headers, signal });
  };
}
