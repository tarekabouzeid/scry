import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, eq, ne } from "drizzle-orm";
import { teams, users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { UpdateUserDto } from "./dto/update-user.dto";
import { AuditService, type AuditActor } from "../audit/audit.service";

// What any signed-in user may see about a colleague: enough to name a
// contact or show a team roster. Role, OIDC subject and timestamps are
// admin-only.
const directoryColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  teamId: users.teamId,
  teamAdmin: users.teamAdmin,
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private async teamName(id: string | null) {
    if (!id) return "no team";
    const [row] = await this.db.select({ name: teams.name }).from(teams).where(eq(teams.id, id));
    return row?.name ?? "a deleted team";
  }

  async list(full: boolean) {
    const query = full
      ? this.db.select().from(users)
      : this.db.select(directoryColumns).from(users);
    return query.orderBy(users.name);
  }

  async getOrThrow(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!row) throw new NotFoundException("User not found");
    return row;
  }

  async getDirectoryEntry(id: string) {
    const [row] = await this.db
      .select(directoryColumns)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("User not found");
    return row;
  }

  async update(actor: AuditActor, id: string, dto: UpdateUserDto) {
    const existing = await this.getOrThrow(id);
    if (existing.role === "admin" && dto.role === "member") {
      const [others] = await this.db
        .select({ admins: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), ne(users.id, id)));
      if (!others?.admins) {
        throw new ConflictException("Scry needs at least one admin — promote someone else first");
      }
    }
    const teamId = dto.teamId !== undefined ? dto.teamId : existing.teamId;
    if (dto.teamAdmin && !teamId) {
      throw new BadRequestException("Only someone in a team can be its team admin");
    }
    // Moving teams starts them as an ordinary member of the new one.
    const teamAdmin = teamId !== existing.teamId ? (dto.teamAdmin ?? false) : dto.teamAdmin;
    const [row] = await this.db
      .update(users)
      .set({ ...dto, ...(teamAdmin !== undefined && { teamAdmin }), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (row!.teamAdmin !== existing.teamAdmin && row!.teamId) {
      const team = await this.teamName(row!.teamId);
      await this.audit.record(
        actor,
        row!.teamAdmin ? "team.admin_granted" : "team.admin_revoked",
        row!.teamAdmin
          ? `${actor.name} made ${row!.name} a team admin of ${team}`
          : `${actor.name} took ${row!.name}'s team admin rights for ${team}`,
        { targetType: "user", targetId: id, teamId: row!.teamId },
      );
    }
    if (row!.role !== existing.role) {
      await this.audit.record(
        actor,
        "user.role_changed",
        `${actor.name} changed ${row!.name}'s role from ${existing.role} to ${row!.role}`,
        { targetType: "user", targetId: id, data: { from: existing.role, to: row!.role } },
      );
    }
    if (row!.teamId !== existing.teamId) {
      const [from, to] = await Promise.all([
        this.teamName(existing.teamId),
        this.teamName(row!.teamId),
      ]);
      await this.audit.record(
        actor,
        "user.team_changed",
        `${actor.name} moved ${row!.name} from ${from} to ${to}`,
        {
          targetType: "user",
          targetId: id,
          teamId: row!.teamId ?? existing.teamId,
          data: { fromTeamId: existing.teamId, toTeamId: row!.teamId, from, to },
        },
      );
    }
    return row!;
  }
}
