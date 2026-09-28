import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { eq, inArray } from "drizzle-orm";
import { initiatives, type Db } from "@scry/db";
import Redis from "ioredis";
import { DB } from "../db/db.module";
import { LlmService } from "../llm/llm.service";
import { OverlapsService } from "../overlaps/overlaps.service";
import { JobsService } from "./jobs.service";
import { REDIS_CONNECTION } from "./queue.module";
import {
  DEFAULT_EMBEDDING_CONCURRENCY,
  EMBEDDING_QUEUE,
  concurrencyFrom,
  type GenerateEmbeddingJob,
} from "./jobs.constants";

@Injectable()
export class EmbeddingProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingProcessor.name);
  private worker?: Worker<GenerateEmbeddingJob>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly llm: LlmService,
    private readonly overlaps: OverlapsService,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // Always running: whether a model is configured is checked per job, so
    // an admin connecting one in the UI takes effect without a restart.
    this.worker = new Worker<GenerateEmbeddingJob>(
      EMBEDDING_QUEUE,
      async (job) => {
        // Not configured: leave it unindexed; saving AI settings backfills.
        if (!(await this.llm.isConfigured())) return;

        const ids =
          job.data.initiativeIds ?? (job.data.initiativeId ? [job.data.initiativeId] : []);
        if (!ids.length) return;
        const rows = await this.db
          .select({ id: initiatives.id, title: initiatives.title, summary: initiatives.summary })
          .from(initiatives)
          .where(inArray(initiatives.id, ids));
        if (!rows.length) return;

        const { embeddings, key } = await this.llm.embedManyKeyed(
          rows.map((r) => `${r.title}\n\n${r.summary}`),
        );
        for (const [n, row] of rows.entries()) {
          await this.db
            .update(initiatives)
            .set({ embedding: embeddings[n]!, embeddingKey: key })
            .where(eq(initiatives.id, row.id));
        }

        // Now that they're searchable, check each against other teams' work.
        for (const row of rows) await this.overlaps.detectFor(row.id);
      },
      {
        connection: this.connection,
        // Mostly waiting on the model and Postgres, so several at once pay off.
        concurrency: concurrencyFrom(
          this.config.get<string>("EMBEDDING_CONCURRENCY"),
          DEFAULT_EMBEDDING_CONCURRENCY,
        ),
      },
    );

    this.worker.on("failed", (job, err) => {
      this.logger.error(`Embedding job ${job?.id} failed: ${err.message}`);
    });

    void this.backfillOnBoot();
  }

  private async backfillOnBoot() {
    try {
      if (await this.llm.isConfigured()) await this.jobs.backfillEmbeddings();
      else
        this.logger.warn(
          "No AI model configured yet — initiatives won't be indexed until an admin connects one",
        );
    } catch (err) {
      this.logger.warn(`Embedding backfill skipped: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
