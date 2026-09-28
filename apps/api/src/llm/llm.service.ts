import {
  BadGatewayException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import {
  embed,
  embedMany,
  generateText,
  Output,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { ConfigService } from "@nestjs/config";
import { authenticatedFetch, credentialProvider, type LlmSecrets } from "./llm-auth";
import { isHostAllowed, outboundUrls, parseAllowedHosts } from "./allowed-hosts";
import { embeddingKey, type LlmRole, type LlmSettings } from "./llm-settings.schema";
import { LlmSettingsService, isConfigured, type ActiveLlmConfig } from "./llm-settings.service";
import { LlmUsageService } from "./llm-usage.service";

export const NOT_CONFIGURED_MESSAGE =
  "Scry's AI isn't set up yet — an admin can connect a model in Admin → AI & models.";

/** The model's vectors aren't the configured size — mixing sizes would break search. */
export class EmbeddingSizeError extends Error {
  constructor(
    readonly model: string,
    readonly actual: number,
    readonly expected: number,
  ) {
    super(
      `"${model}" returns ${actual}-dimensional vectors, but Dimensions is set to ${expected}. ` +
        `Set Dimensions to ${actual}.`,
    );
  }
}

/** Who a call is made for — forwarded to the gateway when user tracking is on. */
export interface LlmCaller {
  id: string;
  email: string;
}

interface Runtime {
  settings: LlmSettings;
  provider: OpenAIProvider;
}

function buildRuntime(settings: LlmSettings, secrets: LlmSecrets): Runtime {
  const credentials = credentialProvider(settings, secrets);
  return {
    settings,
    provider: createOpenAI({
      baseURL: settings.connection.baseUrl.replace(/\/+$/, ""),
      // The real credentials are added per request by the custom fetch.
      apiKey: "scry-managed",
      fetch: authenticatedFetch(settings, credentials),
    }),
  };
}

function userField(settings: LlmSettings, caller?: LlmCaller): string | undefined {
  if (!caller || settings.userTracking === "off") return undefined;
  return settings.userTracking === "email" ? caller.email : caller.id;
}

/**
 * Per-call OpenAI options. Schemas aren't strict: strict mode needs every
 * property required, and gateways vary in how much of it they support.
 */
function chatOptions(settings: LlmSettings, caller?: LlmCaller) {
  const user = userField(settings, caller);
  return { openai: { strictJsonSchema: false, ...(user ? { user } : {}) } };
}

interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

async function embedWith(
  runtime: Runtime,
  text: string,
  caller?: LlmCaller,
): Promise<{ value: number[]; usage: Usage }> {
  const { model, dimensions, shorten } = runtime.settings.models.embedding;
  const { embedding, usage } = await embed({
    model: runtime.provider.embedding(model),
    value: text,
    providerOptions: {
      openai: {
        ...(shorten ? { dimensions } : {}),
        ...(userField(runtime.settings, caller)
          ? { user: userField(runtime.settings, caller) }
          : {}),
      },
    },
    maxRetries: 1,
  });
  if (embedding.length !== dimensions) {
    throw new EmbeddingSizeError(model, embedding.length, dimensions);
  }
  return { value: embedding, usage: { promptTokens: usage?.tokens } };
}

/**
 * Texts per embedding request: big enough to save round trips. Some
 * gateways cap it (older Azure OpenAI deployments take 16), so
 * EMBEDDING_BATCH_SIZE can lower it.
 */
export const EMBED_BATCH_SIZE = batchSizeFrom(process.env.EMBEDDING_BATCH_SIZE);

export function batchSizeFrom(raw: string | undefined, fallback = 50): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2048 ? n : fallback;
}

async function embedManyWith(
  runtime: Runtime,
  texts: string[],
): Promise<{ value: number[][]; usage: Usage }> {
  const { model, dimensions, shorten } = runtime.settings.models.embedding;
  const { embeddings, usage } = await embedMany({
    model: runtime.provider.embedding(model),
    values: texts,
    providerOptions: { openai: shorten ? { dimensions } : {} },
    maxRetries: 1,
  });
  const wrong = embeddings.find((e) => e.length !== dimensions);
  if (wrong) throw new EmbeddingSizeError(model, wrong.length, dimensions);
  return { value: embeddings, usage: { promptTokens: usage?.tokens } };
}

async function objectWith<T extends z.ZodTypeAny>(
  runtime: Runtime,
  role: "assistant" | "tasks",
  args: { schema: T; system?: string; prompt: string; caller?: LlmCaller },
): Promise<{ value: z.infer<T>; usage: Usage }> {
  const { model, temperature } = runtime.settings.models[role];
  // chat(): gateways speak Chat Completions; the default is the Responses API.
  const { output, usage } = await generateText({
    model: runtime.provider.chat(model),
    output: Output.object({ schema: args.schema }),
    system: args.system,
    prompt: args.prompt,
    ...(temperature !== null ? { temperature } : {}),
    maxRetries: 1,
    providerOptions: chatOptions(runtime.settings, args.caller),
  });
  return {
    value: output as z.infer<T>,
    usage: { promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens },
  };
}

/**
 * The one place a model endpoint is called. Which endpoint, how Scry
 * authenticates to it and which model serves each role all come from
 * LlmSettingsService, so an admin can change them at runtime — clients are
 * rebuilt whenever the effective settings change.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private runtime: { version: string; value: Runtime } | null = null;

  constructor(
    private readonly settings: LlmSettingsService,
    private readonly config: ConfigService,
    private readonly usage: LlmUsageService,
  ) {}

  async status() {
    const active = await this.settings.active();
    const { strongMatch, weakMatch } = active.settings.matching;
    return {
      configured: isConfigured(active),
      source: active.source,
      matching: { strongMatch, weakMatch },
    };
  }

  async isConfigured() {
    return isConfigured(await this.settings.active());
  }

  async thresholds() {
    return (await this.settings.active()).settings.matching;
  }

  private async current(): Promise<Runtime> {
    const active: ActiveLlmConfig = await this.settings.active();
    if (!isConfigured(active)) throw new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE);
    // Env-sourced settings (or a list tightened after saving) are checked here too.
    const allowed = parseAllowedHosts(this.config.get<string>("LLM_ALLOWED_HOSTS"));
    if (outboundUrls(active.settings).some((u) => !isHostAllowed(u, allowed))) {
      this.logger.error("The configured AI endpoint isn't in LLM_ALLOWED_HOSTS — AI calls refused");
      throw new ServiceUnavailableException(
        "Scry's AI endpoint isn't allowed on this deployment. An admin needs to check Admin → AI & models.",
      );
    }
    if (this.runtime?.version !== active.version) {
      this.runtime = {
        version: active.version,
        value: buildRuntime(active.settings, active.secrets),
      };
    }
    return this.runtime.value;
  }

  /**
   * Model failures (bad key, unknown model, gateway down) become a 502 with
   * a generic message; the detail goes to the log, not to end users.
   */
  private async guard<T>(
    role: LlmRole,
    model: string,
    fn: () => Promise<{ value: T; usage: Usage }>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const { value, usage } = await fn();
      this.usage.record({ role, model, ok: true, latencyMs: Date.now() - started, ...usage });
      return value;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const message = describeError(err);
      this.usage.record({
        role,
        model,
        ok: false,
        latencyMs: Date.now() - started,
        error: message,
      });
      this.logger.error(`LLM ${role} call failed: ${message}`);
      throw new BadGatewayException(
        "Scry couldn't get an answer from its AI model. If this keeps happening, ask an admin " +
          "to test the connection in Admin → AI & models.",
      );
    }
  }

  async embed(text: string, caller?: LlmCaller): Promise<number[]> {
    return (await this.embedKeyed(text, caller)).embedding;
  }

  /**
   * A search's vector plus the key of the setup that made it (see
   * embeddingKey). Searches get the query prefix; initiatives, embedded by
   * embedManyKeyed, get the document prefix.
   */
  async embedKeyed(text: string, caller?: LlmCaller) {
    const runtime = await this.current();
    const { model, queryPrefix } = runtime.settings.models.embedding;
    const embedding = await this.guard("embedding", model, () =>
      embedWith(runtime, queryPrefix + text, caller),
    );
    return { embedding, key: embeddingKey(runtime.settings) };
  }

  /** The key vectors made now would carry; null while no model is connected. */
  async embeddingKey(): Promise<string | null> {
    const active = await this.settings.active();
    return isConfigured(active) ? embeddingKey(active.settings) : null;
  }

  /**
   * Background indexing: one request per EMBED_BATCH_SIZE texts instead of
   * one per text. Each request is recorded as one call in the usage stats.
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    return (await this.embedManyKeyed(texts)).embeddings;
  }

  /** embedMany, plus the key of the setup that made the vectors. */
  async embedManyKeyed(texts: string[]) {
    const runtime = await this.current();
    const { model, documentPrefix } = runtime.settings.models.embedding;
    const embeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE).map((t) => documentPrefix + t);
      embeddings.push(
        ...(await this.guard("embedding", model, () => embedManyWith(runtime, batch))),
      );
    }
    return { embeddings, key: embeddingKey(runtime.settings) };
  }

  async object<T extends z.ZodTypeAny>(
    role: "assistant" | "tasks",
    args: { schema: T; system?: string; prompt: string; caller?: LlmCaller },
  ): Promise<z.infer<T>> {
    const runtime = await this.current();
    return this.guard(role, runtime.settings.models[role].model, () =>
      objectWith(runtime, role, args),
    );
  }

  /**
   * Like object(), but reports the object as it's generated, so answers can
   * be shown while the model is still writing. Resolves with the final,
   * schema-validated object.
   */
  async streamObject<T extends z.ZodTypeAny>(
    role: "assistant" | "tasks",
    args: { schema: T; system?: string; prompt: string; caller?: LlmCaller },
    onPartial: (partial: Partial<z.infer<T>>) => void,
  ): Promise<z.infer<T>> {
    const runtime = await this.current();
    const { model, temperature } = runtime.settings.models[role];
    return this.guard(role, model, async () => {
      let failure: unknown;
      const result = streamText({
        model: runtime.provider.chat(model),
        output: Output.object({ schema: args.schema }),
        system: args.system,
        prompt: args.prompt,
        ...(temperature !== null ? { temperature } : {}),
        maxRetries: 1,
        providerOptions: chatOptions(runtime.settings, args.caller),
        onError: ({ error }) => {
          failure = error;
        },
      });
      for await (const partial of result.partialOutputStream) {
        onPartial(partial as Partial<z.infer<T>>);
      }
      if (failure) throw failure;
      const [value, usage] = await Promise.all([result.output, result.usage]);
      return {
        value: value as z.infer<T>,
        usage: { promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens },
      };
    });
  }

  /**
   * A tool-using conversation turn with the assistant model: the model may
   * call the given tools (their code runs here, in Scry) for up to maxSteps
   * rounds before answering. Reports the answer's text as it's written and
   * resolves with all of it.
   */
  async agent(args: {
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    maxSteps: number;
    caller?: LlmCaller;
    onText?: (delta: string) => void;
  }): Promise<string> {
    const runtime = await this.current();
    const { model, temperature } = runtime.settings.models.assistant;
    return this.guard("assistant", model, async () => {
      let failure: unknown;
      const result = streamText({
        model: runtime.provider.chat(model),
        system: args.system,
        messages: args.messages,
        tools: args.tools,
        stopWhen: stepCountIs(args.maxSteps),
        ...(temperature !== null ? { temperature } : {}),
        maxRetries: 1,
        providerOptions: chatOptions(runtime.settings, args.caller),
        onError: ({ error }) => {
          failure = error;
        },
      });
      // Text from every step: a model may say a few words before calling a
      // tool, and the person saw those stream in too.
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          text += part.text;
          args.onText?.(part.text);
        }
      }
      if (failure) throw failure;
      const usage = await result.totalUsage;
      return {
        value: text,
        usage: { promptTokens: usage?.inputTokens, completionTokens: usage?.outputTokens },
      };
    });
  }

  /**
   * Try each role against a draft configuration without saving it, so an
   * admin sees exactly what's wrong before switching the whole org over.
   */
  async test(settings: LlmSettings, secrets: LlmSecrets, caller?: LlmCaller) {
    const results: Array<{
      role: LlmRole;
      model: string;
      ok: boolean;
      latencyMs: number;
      detail?: string;
      error?: string;
      /** Embeddings only: the size the model actually returned, when it differs. */
      actualDimensions?: number;
    }> = [];
    let runtime: Runtime;
    try {
      if (!settings.connection.baseUrl) throw new Error("Enter the endpoint's base URL first");
      runtime = buildRuntime(settings, secrets);
    } catch (err) {
      const error = (err as Error).message;
      return (["embedding", "assistant", "tasks"] as const).map((role) => ({
        role,
        model: settings.models[role].model,
        ok: false,
        latencyMs: 0,
        error,
      }));
    }

    const run = async (role: LlmRole, fn: () => Promise<string>) => {
      const started = Date.now();
      try {
        const detail = await fn();
        results.push({
          role,
          model: settings.models[role].model,
          ok: true,
          latencyMs: Date.now() - started,
          detail,
        });
      } catch (err) {
        results.push({
          role,
          model: settings.models[role].model,
          ok: false,
          latencyMs: Date.now() - started,
          error: describeError(err),
          ...(err instanceof EmbeddingSizeError && { actualDimensions: err.actual }),
        });
      }
    };
    const probe = z.object({ ok: z.boolean() });
    const prompt = 'Scry connection test. Reply with the JSON object {"ok": true}.';
    await Promise.all([
      run("embedding", async () => {
        const { value } = await embedWith(runtime, "Scry connection test", caller);
        return `${value.length}-dimensional vectors`;
      }),
      run("assistant", async () => {
        await objectWith(runtime, "assistant", { schema: probe, prompt, caller });
        return "Structured output works";
      }),
      run("tasks", async () => {
        await objectWith(runtime, "tasks", { schema: probe, prompt, caller });
        return "Structured output works";
      }),
    ]);
    const order: LlmRole[] = ["embedding", "assistant", "tasks"];
    return results.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  }
}

/** A readable one-liner from AI SDK / fetch errors, for the admin's test results. */
function describeError(err: unknown): string {
  const e = err as {
    message?: string;
    statusCode?: number;
    responseBody?: string;
    cause?: { code?: string; message?: string };
    name?: string;
  };
  if (e?.name === "TimeoutError" || e?.cause?.code === "ABORT_ERR") {
    return "Timed out — is the endpoint reachable from the Scry api?";
  }
  if (e?.cause?.code === "ECONNREFUSED" || e?.cause?.code === "ENOTFOUND") {
    return `Can't reach the endpoint (${e.cause.code}) — check the base URL from the api's point of view.`;
  }
  let detail = e?.message ?? String(err);
  if (e?.responseBody) {
    try {
      const body = JSON.parse(e.responseBody) as { error?: { message?: string } | string };
      const msg = typeof body.error === "string" ? body.error : body.error?.message;
      if (msg) detail = msg;
    } catch {
      detail = e.responseBody.slice(0, 300);
    }
  }
  return e?.statusCode ? `HTTP ${e.statusCode}: ${detail}` : detail;
}
