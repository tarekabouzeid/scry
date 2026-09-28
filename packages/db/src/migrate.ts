import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  // Re-runs print "already exists, skipping" notices for every statement.
  const { db, sql } = createDb(databaseUrl, { onnotice: () => undefined });
  await migrate(db, { migrationsFolder: join(__dirname, "../migrations") });
  await sql.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
