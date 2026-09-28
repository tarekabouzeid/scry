import { index, pgTable, real, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { overlapStatusEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

// A likely duplicate between two teams' initiatives, found automatically
// when an initiative is embedded. The pair is stored in canonical order
// (initiativeAId < initiativeBId) so each pair has exactly one row.
export const overlaps = pgTable(
  // Not plain "overlaps": OVERLAPS is a reserved word in Postgres.
  "initiative_overlaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiativeAId: uuid("initiative_a_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    initiativeBId: uuid("initiative_b_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    status: overlapStatusEnum("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("overlaps_pair_unique").on(t.initiativeAId, t.initiativeBId),
    index("overlaps_status_score_idx").on(t.status, t.score.desc().nullsFirst()),
    // Overlaps of given initiatives: the pair index covers side A, this side B.
    index("overlaps_b_idx").on(t.initiativeBId),
  ],
);
