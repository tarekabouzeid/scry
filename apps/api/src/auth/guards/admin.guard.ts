import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthedRequest } from "./session-auth.guard";

/** Must run after SessionAuthGuard — relies on req.user being populated. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== "admin") {
      throw new ForbiddenException("Admin role required");
    }
    return true;
  }
}
