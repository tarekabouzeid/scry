import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { userRoleEnum } from "./enums";
import { teams } from "./team";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Present once the identity comes through OIDC claims; never typed by hand.
  employeeId: text("employee_id"),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  role: userRoleEnum("role").notNull().default("member"),
  // Runs their team in Scry: approves people who ask to join, removes
  // members, edits the team's initiatives and sees the team's audit log.
  teamAdmin: boolean("team_admin").notNull().default(false),
  // When they finished or skipped the product tour; null shows it on next visit.
  tourSeenAt: timestamp("tour_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ one }) => ({
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
}));
