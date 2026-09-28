import { createHash } from "node:crypto";
import { z } from "zod";

/** Default embedding size (text-embedding-3-small). pgvector allows up to 16,000. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const MAX_EMBEDDING_DIMENSIONS = 16_000;

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_STRONG_MATCH = 0.85;
const DEFAULT_WEAK_MATCH = 0.65;

const threshold = z.number().min(0).max(1);
const temperature = z.number().min(0).max(2).nullable();
const modelName = z.string().trim().max(200);

export const authSchema = z.object({
  mode: z.enum(["none", "api_key", "oauth2_client_credentials", "signed_jwt"]),
  headerName: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z0-9-]*$/, "Header names can only contain letters, digits and dashes"),
  tokenUrl: z.string().trim().max(2000),
  clientId: z.string().trim().max(500),
  scope: z.string().trim().max(1000),
  audience: z.string().trim().max(500),
  clientAuthMethod: z.enum(["client_secret_basic", "client_secret_post"]),
  issuer: z.string().trim().max(500),
  subject: z.string().trim().max(500),
  ttlSeconds: z.number().int().min(60).max(86_400),
  extraClaims: z.record(z.string(), z.unknown()),
});

const headerName = /^[A-Za-z0-9-]+$/;
// Scry sets these itself; letting a "custom header" override them would
// silently break auth or request framing.
const RESERVED_HEADERS = new Set(["authorization", "content-type", "content-length", "host"]);

export const llmSettingsSchema = z
  .object({
    connection: z.object({
      baseUrl: z.string().trim().max(2000),
      timeoutMs: z.number().int().min(1_000).max(600_000),
      headers: z.record(z.string(), z.string().max(2000)),
      auth: authSchema,
    }),
    models: z.object({
      embedding: z.object({
        model: modelName,
        /** The size every stored vector has — what the model returns. */
        dimensions: z.number().int().min(1).max(MAX_EMBEDDING_DIMENSIONS),
        /** Ask the model to shorten its output to `dimensions` (text-embedding-3-*). */
        shorten: z.boolean(),
        /**
         * Text put before searches and before initiatives. Many open models
         * (EmbeddingGemma, E5, BGE, nomic) are trained with a different
         * prefix for each and match much worse without them.
         */
        queryPrefix: z.string().max(200),
        documentPrefix: z.string().max(200),
      }),
      assistant: z.object({ model: modelName, temperature }),
      tasks: z.object({ model: modelName, temperature }),
    }),
    matching: z.object({ strongMatch: threshold, weakMatch: threshold, overlap: threshold }),
    userTracking: z.enum(["off", "id", "email"]),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const isHttpUrl = (value: string) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    };

    if (s.connection.baseUrl && !isHttpUrl(s.connection.baseUrl)) {
      issue(["connection", "baseUrl"], "Enter an http(s) URL, e.g. http://litellm:4000/v1");
    }
    for (const name of Object.keys(s.connection.headers)) {
      if (!headerName.test(name)) issue(["connection", "headers"], `Invalid header name "${name}"`);
      if (RESERVED_HEADERS.has(name.toLowerCase())) {
        issue(["connection", "headers"], `"${name}" is set by Scry and can't be overridden`);
      }
    }
    const auth = s.connection.auth;
    if (auth.mode === "api_key" && !auth.headerName) {
      issue(["connection", "auth", "headerName"], "Which header carries the key?");
    }
    if (auth.mode === "oauth2_client_credentials") {
      if (!isHttpUrl(auth.tokenUrl)) {
        issue(["connection", "auth", "tokenUrl"], "Enter your IdP's token endpoint URL");
      }
      if (!auth.clientId) issue(["connection", "auth", "clientId"], "Client ID is required");
    }
    if (auth.mode === "signed_jwt") {
      if (!auth.issuer) issue(["connection", "auth", "issuer"], "Issuer is required");
      if (!auth.audience) issue(["connection", "auth", "audience"], "Audience is required");
      if (!auth.subject) issue(["connection", "auth", "subject"], "Subject is required");
    }
    if (s.matching.weakMatch > s.matching.strongMatch) {
      issue(["matching", "weakMatch"], "The weak-match bar can't be above the strong-match bar");
    }
  });

export type LlmSettings = z.infer<typeof llmSettingsSchema>;
export type LlmRole = "embedding" | "assistant" | "tasks";

export function defaultSettings(): LlmSettings {
  return {
    connection: {
      baseUrl: "",
      timeoutMs: 60_000,
      headers: {},
      auth: {
        mode: "none",
        headerName: "Authorization",
        tokenUrl: "",
        clientId: "",
        scope: "",
        audience: "",
        clientAuthMethod: "client_secret_basic",
        issuer: "scry",
        subject: "scry-api",
        ttlSeconds: 300,
        extraClaims: {},
      },
    },
    models: {
      embedding: {
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        shorten: false,
        queryPrefix: "",
        documentPrefix: "",
      },
      assistant: { model: DEFAULT_CHAT_MODEL, temperature: null },
      tasks: { model: DEFAULT_CHAT_MODEL, temperature: null },
    },
    matching: {
      strongMatch: DEFAULT_STRONG_MATCH,
      weakMatch: DEFAULT_WEAK_MATCH,
      overlap: DEFAULT_STRONG_MATCH,
    },
    userTracking: "off",
  };
}

/** An env var as a number, ignoring blanks and junk (an empty var must not become 0). */
function envNumber(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Settings as the environment describes them — the fallback when an admin
 * hasn't saved any, so existing env-configured deployments keep working.
 */
export function settingsFromEnv(env: Record<string, string | undefined>): {
  settings: LlmSettings;
  apiKey: string | null;
} {
  const s = defaultSettings();
  const apiKey = env.LLM_API_KEY?.trim() || null;
  s.connection.baseUrl = env.LLM_BASE_URL?.trim() ?? "";
  if (apiKey) s.connection.auth.mode = "api_key";
  const chat = env.LLM_CHAT_MODEL?.trim();
  if (chat) s.models.assistant.model = s.models.tasks.model = chat;
  const embedding = env.LLM_EMBEDDING_MODEL?.trim();
  if (embedding) s.models.embedding.model = embedding;
  const dims = envNumber(env, "LLM_EMBEDDING_DIMENSIONS");
  if (dims && Number.isInteger(dims) && dims > 0) s.models.embedding.dimensions = dims;
  // Not trimmed: a prefix usually ends in a space or a separator.
  s.models.embedding.queryPrefix = env.LLM_EMBEDDING_QUERY_PREFIX ?? "";
  s.models.embedding.documentPrefix = env.LLM_EMBEDDING_DOCUMENT_PREFIX ?? "";
  s.matching.strongMatch = envNumber(env, "AGENT_STRONG_MATCH_THRESHOLD") ?? s.matching.strongMatch;
  s.matching.weakMatch = envNumber(env, "AGENT_WEAK_MATCH_THRESHOLD") ?? s.matching.weakMatch;
  s.matching.overlap = envNumber(env, "OVERLAP_THRESHOLD") ?? s.matching.strongMatch;
  return { settings: s, apiKey };
}

/**
 * What an embedding vector depends on. When this changes, vectors made
 * before and after aren't comparable, so everything must be re-indexed.
 */
export function embeddingFingerprint(s: LlmSettings): string {
  return JSON.stringify([
    s.connection.baseUrl.replace(/\/+$/, ""),
    s.models.embedding.model,
    s.models.embedding.dimensions,
    s.models.embedding.shorten,
    s.models.embedding.queryPrefix,
    s.models.embedding.documentPrefix,
  ]);
}

/**
 * The fingerprint as a short key stored next to each vector
 * (`initiatives.embedding_key`): only vectors with the same key are compared.
 */
export function embeddingKey(s: LlmSettings): string {
  return createHash("sha256").update(embeddingFingerprint(s)).digest("hex").slice(0, 16);
}

/** Stored config merged over defaults, so rows written by older versions still parse. */
export function parseStoredSettings(raw: unknown): LlmSettings {
  const d = defaultSettings();
  const r = structuredClone((raw ?? {}) as Partial<LlmSettings>);
  // Before sizes were configurable, `dimensions` was only the optional
  // "shorten to" request parameter (null = don't send it).
  const legacy = r.models?.embedding as
    { dimensions?: number | null; shorten?: boolean } | undefined;
  if (legacy && legacy.shorten === undefined) {
    legacy.shorten = typeof legacy.dimensions === "number";
    legacy.dimensions ??= DEFAULT_EMBEDDING_DIMENSIONS;
  }
  const merged = {
    connection: {
      ...d.connection,
      ...r.connection,
      auth: { ...d.connection.auth, ...r.connection?.auth },
    },
    models: {
      embedding: { ...d.models.embedding, ...r.models?.embedding },
      assistant: { ...d.models.assistant, ...r.models?.assistant },
      tasks: { ...d.models.tasks, ...r.models?.tasks },
    },
    matching: { ...d.matching, ...r.matching },
    userTracking: r.userTracking ?? d.userTracking,
  };
  return llmSettingsSchema.parse(merged);
}
