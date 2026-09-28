import { Global, Module } from "@nestjs/common";
import { ActivityController } from "./activity.controller";
import { ActivityService } from "./activity.service";
import { CommentsService } from "./comments.service";

@Global()
@Module({
  controllers: [ActivityController],
  providers: [ActivityService, CommentsService],
  exports: [ActivityService],
})
export class ActivityModule {}
