import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { InitiativesModule } from "../initiatives/initiatives.module";
import { EdgesModule } from "../edges/edges.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [SearchModule, InitiativesModule, EdgesModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
