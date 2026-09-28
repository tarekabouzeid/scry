import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { teams } from "./team";
import { users } from "./user";

// Who changed what in administration and security settings: AI settings,
// roles, team membership, teams, API tokens, bulk imports and merges.
// Append-only; `summary` is a readable sentence written at the time (names
// can change later), `data` the structured detail (never secret values).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    summary: text("summary").notNull(),
    // The team an entry is about, when it's about one: team admins see these.
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    // Millisecond precision so the api's JSON timestamps page exactly ("before").
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_team_idx").on(t.teamId, t.createdAt),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
