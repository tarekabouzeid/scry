import { describe, expect, it, vi } from "vitest";
import { importJWK, jwtVerify } from "jose";
import { SecretBox } from "./secret-box";
import {
  defaultSettings,
  embeddingFingerprint,
  embeddingKey,
  llmSettingsSchema,
  parseStoredSettings,
  settingsFromEnv,
  type LlmSettings,
} from "./llm-settings.schema";
import {
  KEY_ACTIVATION_DELAY_MS,
  activeSigningKey,
  authenticatedFetch,
  createSigningKey,
  credentialProvider,
} from "./llm-auth";
import { isConfigured } from "./llm-settings.service";
import { batchSizeFrom } from "./llm.service";
import { isHostAllowed, outboundUrls, parseAllowedHosts } from "./allowed-hosts";

function settings(patch: (s: LlmSettings) => void = () => {}): LlmSettings {
  const s = defaultSettings();
  s.connection.baseUrl = "http://litellm:4000/v1";
  patch(s);
  return s;
}

describe("SecretBox", () => {
  it("round-trips, and refuses another key or a tampered payload", () => {
    const box = new SecretBox("key-a");
    const sealed = box.seal("sk-secret");
    expect(sealed).not.toContain("sk-secret");
    expect(box.open(sealed)).toBe("sk-secret");
    expect(() => new SecretBox("key-b").open(sealed)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => box.open(parts.join("."))).toThrow();
  });
});

describe("settingsFromEnv (embedding prefixes)", () => {
  it("keeps a prefix exactly as written, trailing space included", () => {
    const { settings: s } = settingsFromEnv({
      LLM_EMBEDDING_QUERY_PREFIX: "task: search result | query: ",
      LLM_EMBEDDING_DOCUMENT_PREFIX: "title: none | text: ",
    });
    expect(s.models.embedding.queryPrefix).toBe("task: search result | query: ");
    expect(s.models.embedding.documentPrefix).toBe("title: none | text: ");
  });
});

describe("settingsFromEnv", () => {
  it("keeps existing env-configured deployments working", () => {
    const { settings: s, apiKey } = settingsFromEnv({
      LLM_BASE_URL: "http://x/v1",
      LLM_API_KEY: "k",
      LLM_CHAT_MODEL: "m",
      AGENT_STRONG_MATCH_THRESHOLD: "0.9",
    });
    expect(apiKey).toBe("k");
    expect(s.connection.auth.mode).toBe("api_key");
    expect(s.models.assistant.model).toBe("m");
    expect(s.models.tasks.model).toBe("m");
    expect(s.matching.strongMatch).toBe(0.9);
    expect(s.matching.overlap).toBe(0.9); // follows the strong-match bar
  });
  it("ignores blank or junk numbers (an empty var must not become 0)", () => {
    const { settings: s } = settingsFromEnv({
      AGENT_WEAK_MATCH_THRESHOLD: "",
      OVERLAP_THRESHOLD: "x",
    });
    expect(s.matching.weakMatch).toBe(0.65);
    expect(s.matching.overlap).toBe(0.85);
    expect(s.connection.baseUrl).toBe("");
  });
});

describe("llmSettingsSchema", () => {
  const errors = (s: LlmSettings) => {
    const r = llmSettingsSchema.safeParse(s);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  it("accepts the defaults", () => expect(errors(settings())).toEqual([]));
  it("checks mode-specific fields", () => {
    expect(errors(settings((s) => (s.connection.auth.mode = "oauth2_client_credentials")))).toEqual(
      ["connection.auth.tokenUrl", "connection.auth.clientId"],
    );
    expect(
      errors(
        settings(
          (s) => ((s.connection.auth.mode = "signed_jwt"), (s.connection.auth.audience = "")),
        ),
      ),
    ).toEqual(["connection.auth.audience"]);
  });
  it("rejects bad URLs, reserved headers and inverted thresholds", () => {
    expect(errors(settings((s) => (s.connection.baseUrl = "file:///etc/passwd")))).toEqual([
      "connection.baseUrl",
    ]);
    expect(errors(settings((s) => (s.connection.headers = { Authorization: "x" })))).toEqual([
      "connection.headers",
    ]);
    expect(errors(settings((s) => (s.matching.weakMatch = 0.95)))).toEqual(["matching.weakMatch"]);
  });
  it("fills fields missing from rows saved by older versions", () => {
    const parsed = parseStoredSettings({ connection: { baseUrl: "http://x/v1" } });
    expect(parsed.connection.auth.mode).toBe("none");
    expect(parsed.models.embedding.model).toBe("text-embedding-3-small");
  });
});

describe("embeddingFingerprint", () => {
  it("changes with the embedding model, not with chat settings or a trailing slash", () => {
    const a = settings();
    expect(embeddingFingerprint(settings((s) => (s.connection.baseUrl += "/")))).toBe(
      embeddingFingerprint(a),
    );
    expect(embeddingFingerprint(settings((s) => (s.models.assistant.model = "other")))).toBe(
      embeddingFingerprint(a),
    );
    expect(embeddingFingerprint(settings((s) => (s.models.embedding.dimensions = 768)))).not.toBe(
      embeddingFingerprint(a),
    );
  });

  it("changes with the prefixes: they change every vector", () => {
    const a = settings();
    for (const key of ["queryPrefix", "documentPrefix"] as const) {
      expect(
        embeddingFingerprint(settings((s) => (s.models.embedding[key] = "task: search | "))),
      ).not.toBe(embeddingFingerprint(a));
    }
  });
});

describe("embeddingKey", () => {
  it("is short, stable, and changes with the model even at the same size", () => {
    const a = settings();
    expect(embeddingKey(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(embeddingKey(settings())).toBe(embeddingKey(a));
    expect(embeddingKey(settings((s) => (s.models.embedding.model = "another-1536")))).not.toBe(
      embeddingKey(a),
    );
  });
});

describe("batchSizeFrom", () => {
  it("takes a sane whole number, else the default", () => {
    expect(batchSizeFrom("16")).toBe(16);
    expect(batchSizeFrom(undefined)).toBe(50);
    for (const bad of ["0", "-3", "2.5", "abc", "5000"]) expect(batchSizeFrom(bad)).toBe(50);
  });
});

describe("isConfigured", () => {
  it("needs a URL and the credential the auth mode requires", () => {
    expect(isConfigured({ settings: defaultSettings(), secrets: {} })).toBe(false);
    expect(isConfigured({ settings: settings(), secrets: {} })).toBe(true);
    const keyed = settings((s) => (s.connection.auth.mode = "api_key"));
    expect(isConfigured({ settings: keyed, secrets: {} })).toBe(false);
    expect(isConfigured({ settings: keyed, secrets: { apiKey: "k" } })).toBe(true);
  });
});

describe("credentialProvider", () => {
  it("api_key: bearer for Authorization, raw for other headers", async () => {
    const bearer = credentialProvider(
      settings((s) => (s.connection.auth.mode = "api_key")),
      { apiKey: "sk-1" },
    );
    expect(await bearer.headers()).toEqual({ authorization: "Bearer sk-1" });
    const azure = credentialProvider(
      settings(
        (s) => ((s.connection.auth.mode = "api_key"), (s.connection.auth.headerName = "api-key")),
      ),
      { apiKey: "sk-1" },
    );
    expect(await azure.headers()).toEqual({ "api-key": "sk-1" });
  });

  it("oauth2: client credentials with basic auth, token cached until expiry", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: "jwt-1", expires_in: 300 }));
    const provider = credentialProvider(
      settings((s) => {
        s.connection.auth.mode = "oauth2_client_credentials";
        s.connection.auth.tokenUrl = "https://idp/token";
        s.connection.auth.clientId = "scry llm";
        s.connection.auth.scope = "litellm";
      }),
      { clientSecret: "p@ss" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await provider.headers()).toEqual({ authorization: "Bearer jwt-1" });
    await provider.headers();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const basic = (init.headers as Record<string, string>).authorization!.replace("Basic ", "");
    expect(Buffer.from(basic, "base64").toString()).toBe("scry%20llm:p%40ss");
    expect(String(init.body)).toBe("grant_type=client_credentials&scope=litellm");
  });

  it("oauth2: surfaces the IdP's error", async () => {
    const fetchImpl = async () =>
      Response.json(
        { error: "invalid_client", error_description: "Invalid client secret" },
        { status: 401 },
      );
    const provider = credentialProvider(
      settings((s) => {
        s.connection.auth.mode = "oauth2_client_credentials";
        s.connection.auth.tokenUrl = "https://idp/token";
        s.connection.auth.clientId = "c";
      }),
      { clientSecret: "wrong" },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(provider.headers()).rejects.toThrow("Invalid client secret");
  });

  it("signed_jwt: an RS256 token that verifies against the published key", async () => {
    const key = await createSigningKey();
    const provider = credentialProvider(
      settings((s) => {
        s.connection.auth.mode = "signed_jwt";
        s.connection.auth.audience = "litellm";
        s.connection.auth.extraClaims = { scope: "litellm_proxy_admin" };
      }),
      { signingKey: key },
    );
    const token = (await provider.headers()).authorization!.replace("Bearer ", "");
    const { payload, protectedHeader } = await jwtVerify(
      token,
      await importJWK(key.publicJwk, "RS256"),
      {
        issuer: "scry",
        audience: "litellm",
      },
    );
    expect(protectedHeader.kid).toBe(key.keyId);
    expect(payload.sub).toBe("scry-api");
    expect(payload.scope).toBe("litellm_proxy_admin");
    expect(key.publicJwk).not.toHaveProperty("d"); // never publish the private part
  });
});

describe("authenticatedFetch", () => {
  it("replaces the SDK's placeholder key and adds custom headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const f = authenticatedFetch(
      settings((s) => (s.connection.headers = { "x-litellm-tags": "scry" })),
      { headers: async () => ({ authorization: "Bearer real" }) },
      fetchImpl as unknown as typeof fetch,
    );
    await f("http://x", {
      headers: { authorization: "Bearer scry-managed", "content-type": "application/json" },
    });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer real");
    expect(headers.get("x-litellm-tags")).toBe("scry");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

describe("activeSigningKey", () => {
  it("keeps signing with the previous key until a rotated one has been published a while", async () => {
    const old = await createSigningKey();
    const fresh = { ...(await createSigningKey()), createdAt: new Date(0).toISOString() };
    expect(activeSigningKey({ signingKey: old })?.keyId).toBe(old.keyId);
    const secrets = { signingKey: fresh, previousSigningKey: old };
    expect(activeSigningKey(secrets, KEY_ACTIVATION_DELAY_MS - 1)?.keyId).toBe(old.keyId);
    expect(activeSigningKey(secrets, KEY_ACTIVATION_DELAY_MS)?.keyId).toBe(fresh.keyId);
  });
});

describe("parseStoredSettings (embedding size)", () => {
  it("reads settings saved before sizes were configurable", () => {
    const off = parseStoredSettings({ models: { embedding: { model: "m", dimensions: null } } });
    expect(off.models.embedding).toEqual({
      model: "m",
      dimensions: 1536,
      shorten: false,
      queryPrefix: "",
      documentPrefix: "",
    });
    const on = parseStoredSettings({ models: { embedding: { model: "m", dimensions: 1024 } } });
    expect(on.models.embedding).toEqual({
      model: "m",
      dimensions: 1024,
      shorten: true,
      queryPrefix: "",
      documentPrefix: "",
    });
  });
  it("takes LLM_EMBEDDING_DIMENSIONS from the environment", () => {
    expect(
      settingsFromEnv({ LLM_EMBEDDING_DIMENSIONS: "768" }).settings.models.embedding.dimensions,
    ).toBe(768);
  });
});

describe("LLM_ALLOWED_HOSTS", () => {
  const allowed = parseAllowedHosts(" litellm:4000, *.openai.azure.com ,api.openai.com");
  it("is off when unset", () => {
    expect(parseAllowedHosts("")).toBeNull();
    expect(isHostAllowed("http://169.254.169.254/latest", null)).toBe(true);
  });
  it("matches host, optional port and wildcard subdomains", () => {
    expect(isHostAllowed("http://litellm:4000/v1", allowed)).toBe(true);
    expect(isHostAllowed("http://litellm:4001/v1", allowed)).toBe(false);
    expect(isHostAllowed("https://acme.openai.azure.com/openai", allowed)).toBe(true);
    expect(isHostAllowed("https://openai.azure.com.evil.io/", allowed)).toBe(false);
    expect(isHostAllowed("https://api.openai.com/v1", allowed)).toBe(true);
    expect(isHostAllowed("http://169.254.169.254/latest", allowed)).toBe(false);
    expect(isHostAllowed("not a url", allowed)).toBe(false);
  });
  it("covers the token URL in OAuth2 mode", () => {
    const s = settings((x) => {
      x.connection.auth.mode = "oauth2_client_credentials";
      x.connection.auth.tokenUrl = "https://idp/token";
    });
    expect(outboundUrls(s)).toEqual(["http://litellm:4000/v1", "https://idp/token"]);
  });
});
