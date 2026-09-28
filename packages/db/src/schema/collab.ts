import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { activityKindEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiativeId: uuid("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_initiative_idx").on(t.initiativeId, t.createdAt)],
);

// Append-only history per initiative. `data` carries kind-specific details
// (changed fields, edge type + other initiative, overlap score, …).
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiativeId: uuid("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    // Null for system-generated events (e.g. overlap detection).
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    kind: activityKindEnum("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_initiative_idx").on(t.initiativeId, t.createdAt),
    // The brief's "what changed": status moves in a period.
    index("activity_status_changed_idx")
      .on(t.createdAt)
      .where(sql`${t.kind} = 'status_changed'`),
  ],
);
