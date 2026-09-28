import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthedRequest } from "../guards/session-auth.guard";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user;
});
