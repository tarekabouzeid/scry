import { Global, Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { InboxController } from "./inbox.controller";
import { NotificationsService } from "./notifications.service";
import { DigestProcessor } from "./digest.processor";
import { DigestQueueInitializer, digestQueueProvider } from "./digest.queue";

// Global so any feature can call notify() without an import chain.
@Global()
@Module({
  controllers: [NotificationsController, InboxController],
  providers: [NotificationsService, digestQueueProvider, DigestQueueInitializer, DigestProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
