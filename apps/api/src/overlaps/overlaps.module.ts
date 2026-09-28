import { Global, Module } from "@nestjs/common";
import { OverlapsController } from "./overlaps.controller";
import { OverlapsService } from "./overlaps.service";

// Global: the embedding worker (jobs) and edges both call into it.
@Global()
@Module({
  controllers: [OverlapsController],
  providers: [OverlapsService],
  exports: [OverlapsService],
})
export class OverlapsModule {}
