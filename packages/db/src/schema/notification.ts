import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { notificationKindEnum, subscriptionTargetEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

// In-app inbox. One row per recipient, fanned out when the event happens.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    initiativeId: uuid("initiative_id").references(() => initiatives.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    // Human-readable one-liner, rendered as-is in the inbox and alerts.
    text: text("text").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// What a user follows beyond their own initiatives: a team (by id), a single
// initiative (by id), or a tag (by its text).
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: subscriptionTargetEnum("target_type").notNull(),
    targetValue: text("target_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("subscriptions_unique").on(t.userId, t.targetType, t.targetValue)],
);
