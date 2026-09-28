import { type AnyPgColumn, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teamStatusEnum } from "./enums";
import { relations } from "drizzle-orm";
import { users } from "./user";
import { initiatives } from "./initiative";

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  orgUnit: text("org_unit"),
  country: text("country"),
  // Teams created during onboarding start pending until an admin approves them;
  // their creator then joins as the team's first team admin.
  status: teamStatusEnum("status").notNull().default("active"),
  createdBy: uuid("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(users),
  initiatives: many(initiatives),
}));
