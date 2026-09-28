import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { DEFAULT_THROTTLE, ScryThrottlerGuard } from "./common/throttle";
import { RedisThrottlerStorage } from "./common/redis-throttler.storage";
import { HealthController } from "./health/health.controller";
import { DbModule } from "./db/db.module";
import { AuthModule } from "./auth/auth.module";
import { TeamsModule } from "./teams/teams.module";
import { UsersModule } from "./users/users.module";
import { InitiativesModule } from "./initiatives/initiatives.module";
import { EdgesModule } from "./edges/edges.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { LlmModule } from "./llm/llm.module";
import { JobsModule } from "./jobs/jobs.module";
import { SearchModule } from "./search/search.module";
import { VectorIndexModule } from "./search/vector-index.service";
import { ChatModule } from "./chat/chat.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ActivityModule } from "./activity/activity.module";
import { OverlapsModule } from "./overlaps/overlaps.module";
import { AuditModule } from "./audit/audit.module";
import { ReportsModule } from "./reports/reports.module";
import { McpModule } from "./mcp/mcp.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Counters live in Redis so limits hold across api replicas.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [DEFAULT_THROTTLE],
        storage: RedisThrottlerStorage.fromUrl(config.getOrThrow<string>("REDIS_URL")),
      }),
    }),
    DbModule,
    AuditModule,
    AuthModule,
    TeamsModule,
    UsersModule,
    InitiativesModule,
    EdgesModule,
    OnboardingModule,
    LlmModule,
    JobsModule,
    SearchModule,
    VectorIndexModule,
    ChatModule,
    NotificationsModule,
    ActivityModule,
    OverlapsModule,
    ReportsModule,
    McpModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ScryThrottlerGuard }],
})
export class AppModule {}
