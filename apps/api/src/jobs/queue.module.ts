import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { EMBEDDING_QUEUE, TLDR_QUEUE } from "./jobs.constants";

export const EMBEDDING_QUEUE_TOKEN = Symbol("EMBEDDING_QUEUE");
export const TLDR_QUEUE_TOKEN = Symbol("TLDR_QUEUE");
export const REDIS_CONNECTION = Symbol("REDIS_CONNECTION");

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONNECTION,
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>("REDIS_URL"), { maxRetriesPerRequest: null }),
      inject: [ConfigService],
    },
    {
      provide: EMBEDDING_QUEUE_TOKEN,
      useFactory: (connection: Redis) => new Queue(EMBEDDING_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
    {
      provide: TLDR_QUEUE_TOKEN,
      useFactory: (connection: Redis) => new Queue(TLDR_QUEUE, { connection }),
      inject: [REDIS_CONNECTION],
    },
  ],
  exports: [EMBEDDING_QUEUE_TOKEN, TLDR_QUEUE_TOKEN, REDIS_CONNECTION],
})
export class QueueModule {}
