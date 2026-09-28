import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user";

// Admin-managed AI configuration: one row (id "default"). `config` holds
// everything that is safe to show an admin (endpoint, auth mode, models,
// thresholds) and is validated by the api on read; `secrets` holds API
// keys, client secrets and signing keys, encrypted by the api
// (AES-256-GCM) — never stored or returned in plain text.
export const llmSettings = pgTable("llm_settings", {
  id: text("id").primaryKey().default("default"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  secrets: text("secrets"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LlmSettingsRow = typeof llmSettings.$inferSelect;
