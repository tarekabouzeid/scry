import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { users, type Db } from "@scry/db";
import { DB } from "../db/db.module";
import type { AuthenticatedUser } from "./types";

/**
 * People made admin when they sign in: INITIAL_ADMIN_EMAILS, comma separated.
 * Never "whoever signs in first", which would hand an install to anyone the
 * identity provider lets in.
 */
export function initialAdminEmails(raw = process.env.INITIAL_ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export interface OidcClaims {
  sub: string;
  email: string;
  name?: string;
  employeeId?: string;
}

@Injectable()
export class UserService {
  constructor(@Inject(DB) private readonly db: Db) {}

  toAuthenticatedUser(row: typeof users.$inferSelect): AuthenticatedUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      teamId: row.teamId,
      teamAdmin: row.teamId !== null && row.teamAdmin,
      tourSeenAt: row.tourSeenAt?.toISOString() ?? null,
    };
  }

  async markTourSeen(id: string) {
    await this.db.update(users).set({ tourSeenAt: new Date() }).where(eq(users.id, id));
  }

  private async anyAdmin() {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .limit(1);
    return !!row;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  /**
   * First login creates the user with no team — the onboarding flow picks up
   * from there (admins don't need a team). Identity fields (name/email/employeeId) always
   * come from OIDC claims, never edited by hand; only team/role are native.
   */
  async upsertFromOidcClaims(claims: OidcClaims) {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, claims.email))
      .limit(1);

    const listed = initialAdminEmails().has(claims.email.toLowerCase());
    if (existing) {
      // A listed person is promoted only if the install has no admin at all
      // (a way back in), so demoting them later sticks.
      const promote = listed && existing.role !== "admin" && !(await this.anyAdmin());
      const [updated] = await this.db
        .update(users)
        .set({
          name: claims.name ?? existing.name,
          employeeId: claims.employeeId ?? existing.employeeId,
          ...(promote && { role: "admin" as const }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated!;
    }

    const [created] = await this.db
      .insert(users)
      .values({
        email: claims.email,
        name: claims.name ?? claims.email,
        employeeId: claims.employeeId,
        role: listed ? "admin" : "member",
        teamId: null,
      })
      .returning();
    return created!;
  }
}
