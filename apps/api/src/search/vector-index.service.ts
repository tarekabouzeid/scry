import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { ensureVectorIndex } from "@scry/db";
import type postgres from "postgres";
import { PG_SQL } from "../db/db.module";
import { LlmSettingsService } from "../llm/llm-settings.service";

/**
 * Keeps the HNSW index on initiatives.embedding matching the configured
 * embedding size. It isn't in the migrations because the size is an admin
 * setting; see packages/db/src/vector-index.ts.
 */
/** How long to wait before retrying while another build holds the lock. */
const RETRY_BUSY_MS = 30_000;

@Injectable()
export class VectorIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VectorIndexService.name);

  constructor(
    @Inject(PG_SQL) private readonly sql: postgres.Sql,
    private readonly llmSettings: LlmSettingsService,
  ) {}

  onApplicationBootstrap() {
    this.ensure();
  }

  /**
   * Fire and forget: building the index on a big table takes minutes, and
   * search works (more slowly) without it meanwhile.
   */
  ensure(): void {
    void this.run();
  }

  private retry?: NodeJS.Timeout;

  private async run() {
    try {
      // Read now, not when asked: a retry must build for the latest size.
      const { dimensions } = (await this.llmSettings.active()).settings.models.embedding;
      const started = Date.now();
      const result = await ensureVectorIndex(
        this.sql,
        dimensions,
        process.env.VECTOR_INDEX_MEMORY || undefined,
      );
      if (result === "busy") {
        // Another build holds the lock (this replica's own start-up build,
        // or another replica's). Try again once it's likely done, or a size
        // changed meanwhile would never get its index.
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.ensure(), RETRY_BUSY_MS);
        this.retry.unref();
      } else if (result === "created") {
        this.logger.log(
          `Built the ${dimensions}-dimension vector index in ${Math.round((Date.now() - started) / 1000)}s`,
        );
      } else if (result === "skipped") {
        this.logger.warn(
          `No vector index for ${dimensions}-dimension embeddings (HNSW stops at 4000); search scans every row`,
        );
      }
    } catch (err) {
      this.logger.warn(`Couldn't check the vector index: ${(err as Error).message}`);
    }
  }
}

// Global so the AI settings screen can ask for a rebuild without a module cycle.
@Global()
@Module({ providers: [VectorIndexService], exports: [VectorIndexService] })
export class VectorIndexModule {}
