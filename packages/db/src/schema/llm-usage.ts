import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// One row per AI model call, for the usage panel in Admin → AI & models
// (calls, errors, latency, tokens per role). Kept for 30 days.
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: text("role").notNull(),
    model: text("model").notNull(),
    ok: boolean("ok").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_created_at_idx").on(t.createdAt)],
);
