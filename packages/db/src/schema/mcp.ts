import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

// The read-only MCP server (AI assistants asking Scry). Off until an admin
// turns it on: using it sends register data to the assistant's AI provider.
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey().default("default"),
  mcpEnabled: boolean("mcp_enabled").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// An AI tool that registered itself (OAuth dynamic client registration).
// Public clients only: no secret, PKCE on every authorization.
export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A one-time authorization code, exchanged for tokens within minutes.
export const oauthCodes = pgTable("oauth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope").notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// Someone let an AI tool read Scry as them. The refresh token rotates on
// every use; revoking the grant cuts off its access tokens at once.
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("oauth_grants_user_idx").on(t.userId)],
);

// One row per MCP tool call: who asked, from which tool, what, and which
// initiatives came back. Pruned after MCP_LOG_RETENTION_DAYS (default 90).
export const mcpCalls = pgTable(
  "mcp_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The AI tool's name, as it registered ("Claude Code"), or the token's name. */
    client: text("client").notNull(),
    /** "oauth" or "token". */
    via: text("via").notNull(),
    grantId: uuid("grant_id").references(() => oauthGrants.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    resultIds: text("result_ids").array().notNull().default([]),
    ok: boolean("ok").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_calls_created_at_idx").on(t.createdAt),
    index("mcp_calls_user_idx").on(t.userId, t.createdAt),
  ],
);

export type McpCallRow = typeof mcpCalls.$inferSelect;
