import { Global, Module } from "@nestjs/common";
import { QueueModule } from "./queue.module";
import { JobsService } from "./jobs.service";
import { EmbeddingProcessor } from "./embedding.processor";
import { TldrProcessor } from "./tldr.processor";

@Global()
@Module({
  imports: [QueueModule],
  providers: [JobsService, EmbeddingProcessor, TldrProcessor],
  exports: [JobsService],
})
export class JobsModule {}
