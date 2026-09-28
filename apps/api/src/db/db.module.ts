import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDb, type Db } from "@scry/db";
import type postgres from "postgres";

export const DB = Symbol("DB");
export const PG_SQL = Symbol("PG_SQL");
const DB_CONNECTION = Symbol("DB_CONNECTION");

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTION,
      useFactory: (config: ConfigService) => createDb(config.getOrThrow<string>("DATABASE_URL")),
      inject: [ConfigService],
    },
    {
      provide: DB,
      useFactory: (conn: { db: Db; sql: postgres.Sql }) => conn.db,
      inject: [DB_CONNECTION],
    },
    {
      provide: PG_SQL,
      useFactory: (conn: { db: Db; sql: postgres.Sql }) => conn.sql,
      inject: [DB_CONNECTION],
    },
  ],
  exports: [DB, PG_SQL],
})
export class DbModule {}
