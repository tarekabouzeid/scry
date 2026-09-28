import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { initiatives } from "./initiative";
import { teams } from "./team";
import { users } from "./user";

// "We need this too": people on other teams saying an idea matters to them.
// Demand from several teams is what turns an idea into a shared initiative,
// so it's recorded per person (with their team at the time) and shown per team.
export const initiativeSignals = pgTable(
  "initiative_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiativeId: uuid("initiative_id")
      .notNull()
      .references(() => initiatives.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Last time the team said it still needs this; old demand fades in the brief.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("initiative_signals_initiative_user").on(t.initiativeId, t.userId),
    index("initiative_signals_team_idx").on(t.teamId),
  ],
);
