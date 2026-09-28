import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { llmSettings, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import { SecretBox } from "./secret-box";
import { createSigningKey, type LlmSecrets } from "./llm-auth";
import {
  defaultSettings,
  embeddingFingerprint,
  parseStoredSettings,
  settingsFromEnv,
  type LlmSettings,
} from "./llm-settings.schema";

const ROW_ID = "default";
// A save is broadcast over Redis so every replica drops its cache at once;
// the TTL is only the backstop for a missed message (e.g. Redis blipped).
const CACHE_TTL_MS = 30_000;
const CHANGED_CHANNEL = "scry:llm-settings:changed";

export type LlmSource = "database" | "environment" | "none";

export interface ActiveLlmConfig {
  source: LlmSource;
  settings: LlmSettings;
  secrets: LlmSecrets;
  secretsReadable: boolean;
  /** Changes whenever the effective configuration does — used to rebuild clients. */
  version: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface SecretsInput {
  apiKey?: string;
  clientSecret?: string;
}

/** Whether the settings + secrets are complete enough to make calls. */
export function isConfigured(config: Pick<ActiveLlmConfig, "settings" | "secrets">): boolean {
  const { settings, secrets } = config;
  if (!settings.connection.baseUrl) return false;
  switch (settings.connection.auth.mode) {
    case "api_key":
      return !!secrets.apiKey;
    case "oauth2_client_credentials":
      return !!secrets.clientSecret;
    case "signed_jwt":
      return !!secrets.signingKey;
    default:
      return true;
  }
}

/**
 * Where Scry's AI configuration lives: the llm_settings row an admin saves
 * from the UI, falling back to LLM_* environment variables when no row
 * exists (so env-configured deployments keep working unchanged).
 */
@Injectable()
export class LlmSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmSettingsService.name);
  private readonly box: SecretBox;
  private cache: { value: ActiveLlmConfig; loadedAt: number } | null = null;
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    const material =
      this.config.get<string>("SETTINGS_ENCRYPTION_KEY")?.trim() ||
      this.config.getOrThrow<string>("SESSION_SECRET");
    this.box = new SecretBox(material);
  }

  private env(): Record<string, string | undefined> {
    const keys = [
      "LLM_BASE_URL",
      "LLM_API_KEY",
      "LLM_CHAT_MODEL",
      "LLM_EMBEDDING_MODEL",
      "AGENT_STRONG_MATCH_THRESHOLD",
      "AGENT_WEAK_MATCH_THRESHOLD",
      "OVERLAP_THRESHOLD",
    ];
    return Object.fromEntries(keys.map((k) => [k, this.config.get<string>(k)]));
  }

  onModuleInit() {
    const url = this.config.get<string>("REDIS_URL");
    if (!url) return;
    const options = { maxRetriesPerRequest: 1, enableOfflineQueue: false };
    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, { ...options, enableOfflineQueue: true });
    for (const conn of [this.publisher, this.subscriber]) conn.on("error", () => undefined);
    this.subscriber.subscribe(CHANGED_CHANNEL).catch((err: Error) => {
      this.logger.warn(`Settings change notifications unavailable: ${err.message}`);
    });
    this.subscriber.on("message", (channel) => {
      if (channel === CHANGED_CHANNEL) this.invalidate();
    });
  }

  async onModuleDestroy() {
    await Promise.all(
      [this.publisher, this.subscriber].map((c) => c?.quit().catch(() => undefined)),
    );
  }

  invalidate() {
    this.cache = null;
  }

  /** Drop the cache here and tell the other replicas to drop theirs. */
  private changed() {
    this.invalidate();
    this.publisher?.publish(CHANGED_CHANNEL, String(Date.now())).catch(() => {
      // Other replicas fall back to the cache TTL.
    });
  }

  async active(): Promise<ActiveLlmConfig> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.value;
    const value = await this.load();
    this.cache = { value, loadedAt: Date.now() };
    return value;
  }

  private async load(): Promise<ActiveLlmConfig> {
    const [row] = await this.db
      .select()
      .from(llmSettings)
      .where(eq(llmSettings.id, ROW_ID))
      .limit(1);

    if (!row) {
      const { settings, apiKey } = settingsFromEnv(this.env());
      return {
        source: settings.connection.baseUrl ? "environment" : "none",
        settings,
        secrets: apiKey ? { apiKey } : {},
        secretsReadable: true,
        version: `env:${embeddingFingerprint(settings)}:${settings.models.assistant.model}`,
        updatedAt: null,
        updatedBy: null,
      };
    }

    let settings: LlmSettings;
    try {
      settings = parseStoredSettings(row.config);
    } catch (err) {
      this.logger.error(`Stored AI settings are invalid, ignoring them: ${(err as Error).message}`);
      settings = defaultSettings();
    }
    const { secrets, readable } = this.openSecrets(row.secrets);
    return {
      source: "database",
      settings,
      secrets,
      secretsReadable: readable,
      // Content-addressed, so even a hand-edited row (updated_at untouched) rebuilds clients.
      version: `db:${createHash("sha256")
        .update(JSON.stringify([settings, row.secrets]))
        .digest("hex")}`,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  private openSecrets(sealed: string | null): { secrets: LlmSecrets; readable: boolean } {
    if (!sealed) return { secrets: {}, readable: true };
    try {
      return { secrets: JSON.parse(this.box.open(sealed)) as LlmSecrets, readable: true };
    } catch {
      this.logger.error(
        "Stored AI secrets can't be decrypted — SETTINGS_ENCRYPTION_KEY or SESSION_SECRET " +
          "changed. An admin needs to re-enter them in Admin → AI & models.",
      );
      return { secrets: {}, readable: false };
    }
  }

  /** Secrets as they would be after applying an admin's edit (omitted = keep, "" = clear). */
  async mergeSecrets(input: SecretsInput = {}): Promise<LlmSecrets> {
    const current = (await this.active()).secrets;
    const next: LlmSecrets = { ...current };
    for (const key of ["apiKey", "clientSecret"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (value.trim() === "") delete next[key];
      else next[key] = value.trim();
    }
    return next;
  }

  private async write(settings: LlmSettings, secrets: LlmSecrets, userId: string) {
    const values = {
      id: ROW_ID,
      config: settings as unknown as Record<string, unknown>,
      secrets: Object.keys(secrets).length ? this.box.seal(JSON.stringify(secrets)) : null,
      updatedBy: userId,
      updatedAt: new Date(),
    };
    await this.db
      .insert(llmSettings)
      .values(values)
      .onConflictDoUpdate({ target: llmSettings.id, set: values });
    this.changed();
  }

  /** Save an admin's settings; reports whether existing embeddings are now stale. */
  async save(userId: string, settings: LlmSettings, secretsInput: SecretsInput) {
    const before = await this.active();
    const secrets = await this.mergeSecrets(secretsInput);
    await this.write(settings, secrets, userId);
    const embeddingsChanged =
      before.source !== "none" &&
      embeddingFingerprint(before.settings) !== embeddingFingerprint(settings);
    return { embeddingsChanged };
  }

  /** New signing key for signed-JWT auth; the old one stays in the JWKS for a grace period. */
  async rotateSigningKey(userId: string) {
    const current = await this.active();
    const key = await createSigningKey();
    const secrets: LlmSecrets = {
      ...current.secrets,
      signingKey: key,
      ...(current.secrets.signingKey && { previousSigningKey: current.secrets.signingKey }),
    };
    await this.write(current.settings, secrets, userId);
    return key;
  }

  /** Forget the admin's settings and go back to the environment (or unconfigured). */
  async reset() {
    await this.db.delete(llmSettings).where(eq(llmSettings.id, ROW_ID));
    this.changed();
  }

  async jwks() {
    const { secrets } = await this.active();
    return {
      keys: [secrets.signingKey, secrets.previousSigningKey]
        .filter((k): k is NonNullable<typeof k> => !!k)
        .map((k) => k.publicJwk),
    };
  }

  async updatedByName(userId: string | null) {
    if (!userId) return null;
    const [row] = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }
}
