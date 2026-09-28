import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../session.service";
import { PatService } from "../pat.service";
import { UserService } from "../user.service";
import type { AuthenticatedUser } from "../types";

export interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly pats: PatService,
    private readonly users: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = await this.pats.resolve(authHeader.slice("Bearer ".length));
      if (!token) throw new UnauthorizedException("Invalid or expired token");
      // A read-only token (the default, and what AI tools get) can't change
      // anything, whatever the person behind it may do.
      if (token.scope === "read" && !["GET", "HEAD"].includes(req.method)) {
        throw new ForbiddenException("This token is read-only");
      }
      req.user = this.users.toAuthenticatedUser(token.user);
      return true;
    }

    const cookieToken = req.cookies?.[this.sessions.cookieName];
    if (cookieToken) {
      const claims = await this.sessions.verify(cookieToken);
      if (!claims) throw new UnauthorizedException("Invalid session");
      const user = await this.users.findById(claims.sub);
      if (!user) throw new UnauthorizedException("Session user no longer exists");
      req.user = this.users.toAuthenticatedUser(user);
      return true;
    }

    throw new UnauthorizedException("Not authenticated");
  }
}
