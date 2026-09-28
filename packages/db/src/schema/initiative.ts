import {
  customType,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { getTableColumns, relations, sql } from "drizzle-orm";
import { initiativeStatusEnum, initiativeTierEnum } from "./enums";
import { teams } from "./team";
import { users } from "./user";

/** The default embedding size (OpenAI text-embedding-3-small); admins can pick another. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

// A pgvector column without a fixed dimension, so admins can switch to an
// embedding model of any size (768, 1024, 3072…) without a migration. The
// api keeps every stored vector the size configured in AI & models (and
// re-indexes when that changes), since vectors of different sizes can't be
// compared. Its HNSW index is the one index NOT declared here: it needs a
// fixed size, so the app creates it for the configured size (partial, on
// `embedding::halfvec(N)`) and drops other sizes' — see ../vector-index.ts.
const anyVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value.slice(1, -1).split(",").filter(Boolean).map(Number),
});

export const initiatives = pgTable(
  "initiatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    status: initiativeStatusEnum("status").notNull().default("idea"),
    tier: initiativeTierEnum("tier").notNull().default("tactical"),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    // Defaults to submittedBy at the application layer on create; reassignable.
    contactPerson: uuid("contact_person")
      .notNull()
      .references(() => users.id),
    startDate: date("start_date"),
    targetDate: date("target_date"),
    tags: text("tags").array().notNull().default([]),
    // Optional convenience link to a Jira epic / Confluence page — never a dependency.
    externalLink: text("external_link"),
    // Why it's on hold, in the owner's words; only meaningful while on hold.
    holdReason: text("hold_reason"),
    embedding: anyVector("embedding"),
    // Which embedding setup (model, size, endpoint) wrote `embedding`, as a
    // short hash. Vectors from different models aren't comparable even at the
    // same size, so search and overlap checks only compare matching keys, and
    // a mismatch marks the row for re-embedding.
    embeddingKey: text("embedding_key"),
    // Set when this initiative was folded into another (a confirmed duplicate).
    // It stays readable — with its comments and history — as "merged into".
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => initiatives.id, {
      onDelete: "set null",
    }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    // One-sentence AI summary of what it is and where it stands. Generated in
    // the background; tldrSource fingerprints the inputs it was written from,
    // so it's only rewritten when those actually change.
    tldr: text("tldr"),
    tldrSource: text("tldr_source"),
    tldrAt: timestamp("tldr_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The list's sorts (keyset on sort value + id), its filters, substring
  // search and tag filters; see tests/perf/queries.mjs for the plans.
  // DESC is spelled NULLS FIRST (Postgres' default for DESC) so a plain
  // `order by updated_at desc, id desc` matches the index, and a backward
  // scan serves the ascending order.
  (t) => [
    index("initiatives_updated_idx").on(t.updatedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("initiatives_team_updated_idx").on(
      t.teamId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index("initiatives_status_updated_idx").on(
      t.status,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // Sorting by status pages on (status, id): without this it sorts every row.
    index("initiatives_status_id_idx").on(t.status, t.id),
    // The brief's "newest" lists: order by created_at desc, id.
    index("initiatives_created_idx").on(t.createdAt.desc().nullsFirst(), t.id),
    index("initiatives_title_idx").on(t.title, t.id),
    index("initiatives_target_idx").on(t.targetDate, t.id),
    index("initiatives_merged_into_idx")
      .on(t.mergedIntoId)
      .where(sql`${t.mergedIntoId} is not null`),
    index("initiatives_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("initiatives_summary_trgm_idx").using("gin", t.summary.op("gin_trgm_ops")),
    index("initiatives_tags_idx").using("gin", t.tags),
  ],
);

// The runtime row shape (Date objects, etc). Distinct from @scry/shared's
// `Initiative`, which is the JSON-over-the-wire shape (dates as strings)
// used by the web app and API clients.
export type InitiativeRow = typeof initiatives.$inferSelect;

// Every column except `embedding` — a large float vector that's only useful
// server-side. Select with this for anything that goes over the wire, or
// each row in a list response carries ~12 KB of numbers nobody reads.
const {
  embedding: _embedding,
  embeddingKey: _embeddingKey,
  tldrSource: _tldrSource,
  ...initiativePublicColumnMap
} = getTableColumns(initiatives);
export const initiativePublicColumns = initiativePublicColumnMap;
export type PublicInitiativeRow = Omit<InitiativeRow, "embedding" | "embeddingKey" | "tldrSource">;

// Public columns plus whether the async embedding job has run yet — i.e.
// whether this initiative is findable by semantic search.
export const initiativeListColumns = {
  ...initiativePublicColumns,
  embeddingReady: sql<boolean>`${initiatives.embedding} is not null`,
  // How many other teams said "we need this too" (initiative_signals). The
  // outer column is spelled out: drizzle renders ${initiatives.id} unqualified
  // here, which inside the subquery would mean the signal's own id.
  signalTeams:
    sql<number>`(select count(distinct s.team_id) from initiative_signals s where s.initiative_id = "initiatives"."id")`.mapWith(
      Number,
    ),
};

export const initiativesRelations = relations(initiatives, ({ one }) => ({
  team: one(teams, { fields: [initiatives.teamId], references: [teams.id] }),
  submitter: one(users, { fields: [initiatives.submittedBy], references: [users.id] }),
  contact: one(users, { fields: [initiatives.contactPerson], references: [users.id] }),
}));
