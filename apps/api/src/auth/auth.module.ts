import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { PatController } from "./pat.controller";
import { OidcService } from "./oidc.service";
import { SessionService } from "./session.service";
import { UserService } from "./user.service";
import { PatService } from "./pat.service";
import { SessionAuthGuard } from "./guards/session-auth.guard";
import { AdminGuard } from "./guards/admin.guard";

@Global()
@Module({
  controllers: [AuthController, PatController],
  providers: [OidcService, SessionService, UserService, PatService, SessionAuthGuard, AdminGuard],
  exports: [SessionAuthGuard, AdminGuard, UserService, SessionService, PatService],
})
export class AuthModule {}
