import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { chatRoleEnum, matchClassificationEnum } from "./enums";
import { initiatives } from "./initiative";
import { users } from "./user";

// Private per-user by default — the agent's scratchpad. Anything confirmed
// out of a conversation (a registered initiative, a confirmed edge) is
// recorded on the initiative itself, independent of this history.
export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  // Set once the idea discussed in this chat is registered as an initiative,
  // so the agent's evidence can then be linked to it as explicit edges.
  registeredInitiativeId: uuid("registered_initiative_id").references(() => initiatives.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface ChatMessageEvidence {
  initiativeId: string;
  via: "semantic" | "graph";
  score?: number;
  hops?: number;
  throughInitiativeId?: string;
  /** A human's verdict on this piece of evidence, once they've given one. */
  decision?: "linked" | "dismissed";
}

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  // STRONG_MATCH/WEAK_MATCH/NO_MATCH evidence cited by the agent, if any —
  // the audit trail of what was surfaced vs. later confirmed/dismissed.
  evidence: jsonb("evidence").$type<ChatMessageEvidence[]>(),
  // The deterministic STRONG/WEAK/NO_MATCH branch for assistant replies;
  // null when the conversation had no idea to search for yet.
  classification: matchClassificationEnum("classification"),
  // What the reply searched for: the idea as understood from the whole
  // conversation so far (AI-written), or null when nothing was searched.
  searchQuery: text("search_query"),
  // The model judged the idea concrete enough to register, so the reply
  // offers it. People still decide.
  registerReady: boolean("register_ready").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, { fields: [chatMessages.sessionId], references: [chatSessions.id] }),
}));
