import { Global, Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { LlmSettingsService } from "./llm-settings.service";
import { LlmController } from "./llm.controller";
import { LlmUsageService } from "./llm-usage.service";

@Global()
@Module({
  controllers: [LlmController],
  providers: [LlmService, LlmSettingsService, LlmUsageService],
  exports: [LlmService, LlmSettingsService],
})
export class LlmModule {}
