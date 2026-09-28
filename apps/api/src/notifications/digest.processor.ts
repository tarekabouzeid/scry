import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";
import type Redis from "ioredis";
import { REDIS_CONNECTION } from "../jobs/queue.module";
import { NotificationsService } from "./notifications.service";
import { DIGEST_QUEUE } from "./notifications.constants";

@Injectable()
export class DigestProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestProcessor.name);
  private worker?: Worker;

  constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      DIGEST_QUEUE,
      async () => {
        await this.notifications.sendDigest();
      },
      { connection: this.connection },
    );

    this.worker.on("failed", (job, err) => {
      this.logger.error(`Digest job ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
