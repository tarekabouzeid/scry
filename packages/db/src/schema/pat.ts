import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tokenScopeEnum } from "./enums";
import { relations } from "drizzle-orm";
import { users } from "./user";

// Personal access token for scripts and AI tools (MCP), minted from the web
// app. The raw token is only ever returned once at creation; only its hash
// is stored, looked up by SessionAuthGuard (REST) and the MCP guard.
export const personalAccessTokens = pgTable("personal_access_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name"),
  // "read" tokens can only read (GET); tokens from before scopes existed
  // keep acting fully as their owner, so the column defaults to "write".
  scope: tokenScopeEnum("scope").notNull().default("write"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const personalAccessTokensRelations = relations(personalAccessTokens, ({ one }) => ({
  user: one(users, { fields: [personalAccessTokens.userId], references: [users.id] }),
}));
