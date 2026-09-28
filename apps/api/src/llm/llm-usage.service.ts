import { Inject, Injectable, Logger } from "@nestjs/common";
import { lt, sql } from "drizzle-orm";
import { llmCalls, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { LlmRole } from "./llm-settings.schema";

const RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60_000;

export interface LlmCallRecord {
  role: LlmRole;
  model: string;
  ok: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}

/** Records every model call and summarises them for the AI & models page. */
@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);
  private lastPrune = 0;

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Fire-and-forget: usage stats must never slow down or fail a model call. */
  record(call: LlmCallRecord) {
    this.db
      .insert(llmCalls)
      .values({
        ...call,
        promptTokens: Number.isFinite(call.promptTokens) ? call.promptTokens : null,
        completionTokens: Number.isFinite(call.completionTokens) ? call.completionTokens : null,
        error: call.error?.slice(0, 500),
      })
      .catch((err: Error) => this.logger.warn(`Usage not recorded: ${err.message}`));
    if (Date.now() - this.lastPrune > PRUNE_EVERY_MS) {
      this.lastPrune = Date.now();
      this.db
        .delete(llmCalls)
        .where(lt(llmCalls.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`))
        .catch(() => undefined);
    }
  }

  async summary(hours: number) {
    const since = sql`now() - make_interval(hours => ${hours})`;
    const perRole = await this.db.execute<{
      role: string;
      calls: number;
      errors: number;
      p50: number | null;
      p95: number | null;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      last_error: string | null;
      last_error_at: string | null;
    }>(sql`
      select role,
        count(*)::int as calls,
        count(*) filter (where not ok)::int as errors,
        round(percentile_cont(0.5) within group (order by latency_ms))::int as p50,
        round(percentile_cont(0.95) within group (order by latency_ms))::int as p95,
        sum(prompt_tokens)::bigint::float8 as prompt_tokens,
        sum(completion_tokens)::bigint::float8 as completion_tokens,
        (array_agg(error order by created_at desc) filter (where not ok))[1] as last_error,
        max(created_at) filter (where not ok) as last_error_at
      from ${llmCalls}
      where created_at > ${since}
      group by role`);
    // Calls per time bucket, for the activity strip (hourly for a day, else daily).
    const bucket = hours <= 24 ? "hour" : "day";
    const series = await this.db.execute<{ at: string; calls: number; errors: number }>(sql`
      select date_trunc(${bucket}, created_at) as at,
        count(*)::int as calls,
        count(*) filter (where not ok)::int as errors
      from ${llmCalls}
      where created_at > ${since}
      group by 1 order by 1`);
    return {
      hours,
      bucket,
      roles: perRole.map((r) => ({
        role: r.role,
        calls: r.calls,
        errors: r.errors,
        p50: r.p50,
        p95: r.p95,
        promptTokens: r.prompt_tokens,
        completionTokens: r.completion_tokens,
        lastError:
          r.last_error && r.last_error_at
            ? { message: r.last_error, at: new Date(r.last_error_at).toISOString() }
            : null,
      })),
      series: series.map((s) => ({
        at: new Date(s.at).toISOString(),
        calls: s.calls,
        errors: s.errors,
      })),
    };
  }
}
