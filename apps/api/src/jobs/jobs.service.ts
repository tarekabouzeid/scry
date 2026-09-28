import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { and, asc, count, gt, isNull, or, sql, type SQL } from "drizzle-orm";
import { initiatives, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import { LlmSettingsService } from "../llm/llm-settings.service";
import { embeddingKey } from "../llm/llm-settings.schema";
import { EMBEDDING_QUEUE_TOKEN, TLDR_QUEUE_TOKEN } from "./queue.module";
import { EMBED_BATCH_SIZE } from "../llm/llm.service";
import { chunk, type GenerateEmbeddingJob, type GenerateTldrJob } from "./jobs.constants";

/** Ids read per query while backfilling, so a million rows never sit in one result. */
export const BACKFILL_PAGE = 10_000;

const TLDR_JOB = { delay: 2000, removeOnComplete: true, removeOnFail: 100 } as const;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(EMBEDDING_QUEUE_TOKEN) private readonly embeddingQueue: Queue<GenerateEmbeddingJob>,
    @Inject(TLDR_QUEUE_TOKEN) private readonly tldrQueue: Queue<GenerateTldrJob>,
    @Inject(DB) private readonly db: Db,
    private readonly llmSettings: LlmSettingsService,
  ) {}

  /**
   * Rows that need (re-)embedding: none yet, or one written by another
   * embedding setup (model, size or endpoint; see embeddingKey).
   */
  private async staleCondition() {
    const key = embeddingKey((await this.llmSettings.active()).settings);
    return or(
      isNull(initiatives.embedding),
      sql`${initiatives.embeddingKey} is distinct from ${key}`,
    );
  }

  /**
   * Deliberately not awaited by callers (see initiatives.service.ts) — and
   * doesn't await Redis itself here either. The queue's connection retries
   * indefinitely when Redis is unreachable (maxRetriesPerRequest: null), so
   * an awaited add() would hang the request that triggered it (this was a
   * real bug: POST /initiatives hung forever with Redis down). Embedding
   * generation is inherently best-effort background work — it should never
   * be able to take the request path down with it.
   */
  enqueueEmbedding(initiativeId: string): void {
    this.embeddingQueue
      .add("generate", { initiativeId }, { removeOnComplete: 100, removeOnFail: 100 })
      .catch((err: Error) => this.logger.error(`Failed to enqueue embedding job: ${err.message}`));
  }

  /**
   * (Re)write an initiative's TL;DR once things settle. The job id collapses
   * a burst of edits into one job while it waits, and the worker skips the
   * model call entirely when the TL;DR's inputs haven't changed. Fire and
   * forget, like embeddings.
   */
  enqueueTldr(...initiativeIds: string[]): void {
    for (const initiativeId of new Set(initiativeIds)) {
      this.tldrQueue
        .add("generate", { initiativeId }, { jobId: `tldr-${initiativeId}`, ...TLDR_JOB })
        .catch((err: Error) => this.logger.error(`Failed to enqueue TL;DR job: ${err.message}`));
    }
  }

  /**
   * Walks the matching initiative ids in pages (keyset on id) and hands
   * each page to `enqueue`, which queues it without waiting (see above).
   * Returns how many there were.
   */
  private async eachPage(where: SQL | undefined, enqueue: (ids: string[]) => void) {
    let total = 0;
    let after: string | null = null;
    for (;;) {
      const page: { id: string }[] = await this.db
        .select({ id: initiatives.id })
        .from(initiatives)
        .where(and(where, after ? gt(initiatives.id, after) : undefined))
        .orderBy(asc(initiatives.id))
        .limit(BACKFILL_PAGE);
      if (!page.length) return total;
      total += page.length;
      enqueue(page.map((p) => p.id));
      if (page.length < BACKFILL_PAGE) return total;
      after = page[page.length - 1]!.id;
    }
  }

  /** Queue embeddings in batches: one job, and one model request, per EMBED_BATCH_SIZE. */
  private enqueueEmbeddingBatches(ids: string[]) {
    this.embeddingQueue
      .addBulk(
        chunk(ids, EMBED_BATCH_SIZE).map((initiativeIds) => ({
          name: "generate",
          data: { initiativeIds },
          opts: { removeOnComplete: 100, removeOnFail: 100 },
        })),
      )
      .catch((err: Error) => this.logger.error(`Failed to enqueue embedding jobs: ${err.message}`));
  }

  /** Live initiatives without a TL;DR yet (seed data, or written before AI was connected). */
  async backfillTldrs(): Promise<number> {
    const queued = await this.eachPage(
      and(isNull(initiatives.tldr), isNull(initiatives.mergedIntoId)),
      (ids) =>
        this.tldrQueue
          .addBulk(
            ids.map((initiativeId) => ({
              name: "generate",
              data: { initiativeId },
              // Same job id as enqueueTldr, so a pending edit and the backfill collapse.
              opts: { jobId: `tldr-${initiativeId}`, ...TLDR_JOB },
            })),
          )
          .catch((err: Error) => this.logger.error(`Failed to enqueue TL;DR jobs: ${err.message}`)),
    );
    if (queued) this.logger.log(`Queued TL;DRs for ${queued} initiative(s)`);
    return queued;
  }

  /**
   * Anything without an embedding (or with one of the wrong size) — seed data, rows from before the AI was
   * configured, jobs lost while Redis was down — is invisible to semantic
   * search and overlap detection. Queue those.
   */
  async backfillEmbeddings(): Promise<number> {
    const queued = await this.eachPage(await this.staleCondition(), (ids) =>
      this.enqueueEmbeddingBatches(ids),
    );
    if (queued) this.logger.log(`Queued embeddings for ${queued} unindexed initiative(s)`);
    return queued;
  }

  /**
   * The embedding setup changed: every row now carries another key, so the
   * backfill picks them all up. Old vectors stay until each new one is
   * written, but search and overlap checks only compare vectors with the
   * current key, so they're never mixed.
   */
  async reindexAll(): Promise<number> {
    return this.backfillEmbeddings();
  }

  async indexingProgress() {
    const key = embeddingKey((await this.llmSettings.active()).settings);
    const [row] = await this.db
      .select({
        total: count(),
        indexed: sql<number>`count(*) filter (where ${initiatives.embeddingKey} = ${key})`.mapWith(
          Number,
        ),
      })
      .from(initiatives);
    return { total: row?.total ?? 0, indexed: row?.indexed ?? 0 };
  }
}
