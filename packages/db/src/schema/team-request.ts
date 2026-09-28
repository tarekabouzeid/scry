import { sql } from "drizzle-orm";
import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { joinRequestStatusEnum } from "./enums";
import { teams } from "./team";
import { users } from "./user";

// Someone asking to join a team. Its team admins (or an admin) approve or
// decline; until then the person can look around but not change anything.
export const teamJoinRequests = pgTable(
  "team_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    status: joinRequestStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One open request per person at a time.
  (t) => [
    uniqueIndex("team_join_requests_one_pending")
      .on(t.userId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type TeamJoinRequestRow = typeof teamJoinRequests.$inferSelect;
