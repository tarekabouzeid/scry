import { Module } from "@nestjs/common";
import { InitiativesController } from "./initiatives.controller";
import { InitiativesService } from "./initiatives.service";
import { MergeService } from "./merge.service";
import { MergeRequestsController } from "./merge-requests.controller";
import { SignalsService } from "./signals.service";
import { AssistService } from "./assist.service";
import { TagsCache } from "./tags-cache";

@Module({
  controllers: [InitiativesController, MergeRequestsController],
  providers: [InitiativesService, MergeService, SignalsService, AssistService, TagsCache],
  exports: [InitiativesService, SignalsService],
})
export class InitiativesModule {}
