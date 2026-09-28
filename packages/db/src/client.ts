import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(
  databaseUrl: string,
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
): { db: Db; sql: postgres.Sql } {
  const sql = postgres(databaseUrl, options);
  const db = drizzle(sql, { schema });
  return { db, sql };
}
