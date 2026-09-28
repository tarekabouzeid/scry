import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AdminGuard } from "../auth/guards/admin.guard";
import { AuditService } from "./audit.service";

@ApiTags("audit")
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, AdminGuard)
@Controller("admin/audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query("limit") limit?: string,
    @Query("before") before?: string,
    @Query("action") action?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    // Cursor: "<createdAt ISO>_<id>" of the last entry already shown.
    let cursor: { createdAt: Date; id: string } | undefined;
    if (before) {
      const [iso, id] = before.split("_");
      const createdAt = new Date(iso ?? "");
      if (Number.isNaN(createdAt.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) {
        throw new BadRequestException("Invalid cursor");
      }
      cursor = { createdAt, id };
    }
    if (action && !/^[a-z]+\.[a-z_]+$/.test(action)) {
      throw new BadRequestException("Unknown action");
    }
    return this.audit.list({ limit: n, before: cursor, action });
  }
}
