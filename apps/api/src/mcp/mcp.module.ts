import { Module } from "@nestjs/common";
import { InitiativesModule } from "../initiatives/initiatives.module";
import { SearchModule } from "../search/search.module";
import { EdgesModule } from "../edges/edges.module";
import { TeamsModule } from "../teams/teams.module";
import { ReportsModule } from "../reports/reports.module";
import { McpController } from "./mcp.controller";
import { OAuthController } from "./oauth.controller";
import { McpToolsService } from "./mcp-tools.service";
import { McpSettingsService } from "./mcp-settings.service";
import { OAuthService } from "./oauth.service";

@Module({
  imports: [InitiativesModule, SearchModule, EdgesModule, TeamsModule, ReportsModule],
  controllers: [McpController, OAuthController],
  providers: [McpToolsService, McpSettingsService, OAuthService],
})
export class McpModule {}
