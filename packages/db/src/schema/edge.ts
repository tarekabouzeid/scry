import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { edgeTypeEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

// Explicit, confirmed relationships only — few and human-entered/confirmed.
// Unconfirmed semantic matches the agent surfaces live in ChatMessage
// evidence, never here, until a human accepts one.
export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromInitiativeId: uuid("from_initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    toInitiativeId: uuid("to_initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    type: edgeTypeEnum("type").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Walked in both directions (graph.ts), and one relationship per pair
  // whichever way round, as the api already checks.
  (t) => [
    index("edges_from_idx").on(t.fromInitiativeId),
    index("edges_to_idx").on(t.toInitiativeId),
    uniqueIndex("edges_pair_unique").on(
      sql`least(${t.fromInitiativeId}, ${t.toInitiativeId})`,
      sql`greatest(${t.fromInitiativeId}, ${t.toInitiativeId})`,
    ),
  ],
);

export const edgesRelations = relations(edges, ({ one }) => ({
  from: one(initiatives, {
    fields: [edges.fromInitiativeId],
    references: [initiatives.id],
    relationName: "edgeFrom",
  }),
  to: one(initiatives, {
    fields: [edges.toInitiativeId],
    references: [initiatives.id],
    relationName: "edgeTo",
  }),
  creator: one(users, { fields: [edges.createdBy], references: [users.id] }),
}));
