import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { REDIS_CONNECTION } from "../jobs/queue.module";
import { DEFAULT_DIGEST_CRON, DIGEST_JOB_NAME, DIGEST_QUEUE } from "./notifications.constants";

export const DIGEST_QUEUE_TOKEN = Symbol("DIGEST_QUEUE");

/**
 * Registers the weekly-digest job scheduler on boot. The scheduler has a
 * fixed id, so upserting it on every startup keeps exactly one schedule,
 * and a changed cron pattern replaces the old one.
 */
@Injectable()
export class DigestQueueInitializer implements OnModuleInit {
  private readonly logger = new Logger(DigestQueueInitializer.name);

  constructor(
    @Inject(DIGEST_QUEUE_TOKEN) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const pattern = this.config.get<string>("NOTIFICATIONS_CRON") || DEFAULT_DIGEST_CRON;
    // Fire-and-forget: the queue connection retries indefinitely when Redis
    // is unreachable (maxRetriesPerRequest: null), so awaiting this here
    // would hang the whole app's bootstrap — it registers whenever Redis
    // becomes available instead of blocking boot on it.
    this.queue
      .upsertJobScheduler(DIGEST_JOB_NAME, { pattern }, { name: DIGEST_JOB_NAME, data: {} })
      .then(() => this.removeOlderSchedules())
      .then(() => this.logger.log(`Weekly digest scheduled: "${pattern}"`))
      .catch((err: Error) => this.logger.error(`Failed to schedule weekly digest: ${err.message}`));
  }

  /** Schedules made by BullMQ 5's add({ repeat }) have other ids; drop them so the digest runs once. */
  private async removeOlderSchedules() {
    for (const scheduler of await this.queue.getJobSchedulers()) {
      if (scheduler.name === DIGEST_JOB_NAME && scheduler.key !== DIGEST_JOB_NAME) {
        await this.queue.removeJobScheduler(scheduler.key);
      }
    }
  }
}

export const digestQueueProvider = {
  provide: DIGEST_QUEUE_TOKEN,
  useFactory: (connection: Redis) => new Queue(DIGEST_QUEUE, { connection }),
  inject: [REDIS_CONNECTION],
};
