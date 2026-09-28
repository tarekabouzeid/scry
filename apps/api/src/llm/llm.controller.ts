import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import { JobsService } from "../jobs/jobs.service";
import { LlmThrottle } from "../common/throttle";
import { AuditService } from "../audit/audit.service";
import { changedPaths } from "../audit/diff";
import { ConfigService } from "@nestjs/config";
import { isHostAllowed, outboundUrls, parseAllowedHosts } from "./allowed-hosts";
import { LlmService } from "./llm.service";
import { LlmUsageService } from "./llm-usage.service";
import { KEY_ACTIVATION_DELAY_MS, activeSigningKey } from "./llm-auth";
import { LlmSettingsService } from "./llm-settings.service";
import { VectorIndexService } from "../search/vector-index.service";
import { defaultSettings, llmSettingsSchema, type LlmSettings } from "./llm-settings.schema";

export const JWKS_PATH = "/.well-known/jwks.json";

const secretsSchema = z
  .object({ apiKey: z.string().max(4000), clientSecret: z.string().max(4000) })
  .partial()
  .strict();

const bodySchema = z.object({ settings: z.unknown(), secrets: secretsSchema.optional() }).strict();

/** zod errors as one readable line per field, e.g. "connection.baseUrl: Enter an http(s) URL". */
function parseBody(body: unknown): {
  settings: LlmSettings;
  secrets: z.infer<typeof secretsSchema>;
} {
  const outer = bodySchema.safeParse(body);
  if (!outer.success) throw new BadRequestException("Expected { settings, secrets? }");
  const settings = llmSettingsSchema.safeParse(outer.data.settings);
  if (!settings.success) {
    throw new BadRequestException(
      settings.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return { settings: settings.data, secrets: outer.data.secrets ?? {} };
}

@ApiTags("llm")
@Controller()
export class LlmController {
  constructor(
    private readonly llm: LlmService,
    private readonly settings: LlmSettingsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly usageStats: LlmUsageService,
    private readonly vectorIndex: VectorIndexService,
  ) {}

  private get allowedHosts() {
    return parseAllowedHosts(this.config.get<string>("LLM_ALLOWED_HOSTS"));
  }

  /** Refuse endpoints outside LLM_ALLOWED_HOSTS before any request is made. */
  private assertAllowed(settings: LlmSettings) {
    const allowed = this.allowedHosts;
    const blocked = outboundUrls(settings).filter((u) => !isHostAllowed(u, allowed));
    if (blocked.length) {
      throw new BadRequestException(
        `${blocked.map((u) => new URL(u).host).join(", ")} isn't an allowed AI host on this ` +
          `deployment (LLM_ALLOWED_HOSTS: ${allowed!.join(", ")}).`,
      );
    }
  }

  /** Whether AI features are available — every signed-in user's UI asks this. */
  @Get("llm/status")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard)
  status() {
    return this.llm.status();
  }

  /**
   * Public keys for Scry-signed JWTs (the "Scry-signed JWT" auth mode).
   * Point the gateway at this — for LiteLLM, JWT_PUBLIC_KEY_URL.
   */
  @Get(JWKS_PATH.slice(1))
  jwks() {
    return this.settings.jwks();
  }

  @Get("admin/llm")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  view() {
    return this.buildView();
  }

  @Put("admin/llm")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  async save(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { settings, secrets } = parseBody(body);
    this.assertAllowed(settings);
    const before = await this.settings.active();
    const { embeddingsChanged } = await this.settings.save(user.id, settings, secrets);
    const changed = before.source === "database" ? changedPaths(before.settings, settings) : [];
    // Which credentials changed — never their values.
    const credentials = Object.entries(secrets).map(([k, v]) => `${k} ${v ? "set" : "removed"}`);
    await this.audit.record(
      user,
      "ai.settings_saved",
      before.source === "database"
        ? `${user.name} changed the AI settings${changed.length ? ` (${changed.length} field${changed.length === 1 ? "" : "s"})` : ""}`
        : `${user.name} connected the AI model at ${settings.connection.baseUrl}`,
      {
        targetType: "ai_settings",
        data: {
          changed,
          credentials,
          baseUrl: settings.connection.baseUrl,
          authMode: settings.connection.auth.mode,
          models: {
            embedding: settings.models.embedding.model,
            assistant: settings.models.assistant.model,
            tasks: settings.models.tasks.model,
          },
          reindexed: embeddingsChanged,
        },
      },
    );
    // The index is per embedding size (a no-op when that didn't change).
    this.vectorIndex.ensure();
    // Vectors from another model aren't comparable: start over. Otherwise
    // just index whatever is missing (e.g. everything, on first setup).
    const queued = embeddingsChanged
      ? await this.jobs.reindexAll()
      : (await this.llm.isConfigured())
        ? await this.jobs.backfillEmbeddings()
        : 0;
    if (await this.llm.isConfigured()) await this.jobs.backfillTldrs();
    return { ...(await this.buildView()), reindex: { reset: embeddingsChanged, queued } };
  }

  @Get("admin/llm/usage")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  usage(@Query("hours") hours?: string) {
    const h = Number(hours);
    return this.usageStats.summary([24, 168, 720].includes(h) ? h : 24);
  }

  @Post("admin/llm/test")
  @ApiBearerAuth()
  @LlmThrottle()
  @UseGuards(SessionAuthGuard, AdminGuard)
  async test(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { settings, secrets } = parseBody(body);
    this.assertAllowed(settings);
    const merged = await this.settings.mergeSecrets(secrets);
    return this.llm.test(settings, merged, user);
  }

  @Post("admin/llm/signing-key")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  async rotateSigningKey(@CurrentUser() user: AuthenticatedUser) {
    const key = await this.settings.rotateSigningKey(user.id);
    await this.audit.record(
      user,
      "ai.signing_key_rotated",
      `${user.name} rotated the AI signing key`,
      {
        targetType: "ai_settings",
        data: { keyId: key.keyId },
      },
    );
    return this.buildView();
  }

  @Post("admin/llm/reindex")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  async reindex(@CurrentUser() user: AuthenticatedUser) {
    if (!(await this.llm.isConfigured())) {
      throw new BadRequestException("Connect a model before re-indexing");
    }
    const queued = await this.jobs.reindexAll();
    await this.audit.record(user, "ai.reindexed", `${user.name} re-indexed ${queued} initiatives`, {
      targetType: "ai_settings",
      data: { queued },
    });
    return { queued };
  }

  @Delete("admin/llm")
  @ApiBearerAuth()
  @UseGuards(SessionAuthGuard, AdminGuard)
  async reset(@CurrentUser() user: AuthenticatedUser) {
    await this.settings.reset();
    await this.audit.record(user, "ai.settings_removed", `${user.name} removed the AI settings`, {
      targetType: "ai_settings",
    });
    return this.buildView();
  }

  private async buildView() {
    const active = await this.settings.active();
    const { secrets } = active;
    return {
      source: active.source,
      settings: active.settings,
      defaults: defaultSettings(),
      secrets: {
        apiKey: !!secrets.apiKey,
        clientSecret: !!secrets.clientSecret,
        signingKey: !!secrets.signingKey,
      },
      secretsReadable: active.secretsReadable,
      signingKey: secrets.signingKey
        ? {
            keyId: secrets.signingKey.keyId,
            createdAt: secrets.signingKey.createdAt,
            // When a rotated key starts signing (null: it already does).
            activatesAt:
              activeSigningKey(secrets)?.keyId === secrets.signingKey.keyId
                ? null
                : new Date(
                    Date.parse(secrets.signingKey.createdAt) + KEY_ACTIVATION_DELAY_MS,
                  ).toISOString(),
          }
        : null,
      jwksPath: JWKS_PATH,
      allowedHosts: this.allowedHosts,
      indexing: await this.jobs.indexingProgress(),
      updatedAt: active.updatedAt?.toISOString() ?? null,
      updatedBy: await this.settings.updatedByName(active.updatedBy),
    };
  }
}
