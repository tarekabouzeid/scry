import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mergeRequestStatusEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

// Folding one team's initiative into another team's changes the other
// team's work (it takes on the relationships, demand, tags and followers),
// so unless the person merging can edit both, the target's owners decide.
export const mergeRequests = pgTable(
  "merge_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The duplicate, which would be marked merged. */
    sourceId: uuid("source_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    /** The initiative that carries on. */
    targetId: uuid("target_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    status: mergeRequestStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One open request per duplicate at a time.
    uniqueIndex("merge_requests_one_pending")
      .on(t.sourceId)
      .where(sql`${t.status} = 'pending'`),
    index("merge_requests_target_idx").on(t.targetId, t.status),
  ],
);

export type MergeRequestRow = typeof mergeRequests.$inferSelect;
