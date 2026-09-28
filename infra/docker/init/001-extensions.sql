-- Runs once against POSTGRES_DB on first container init. Migrations create
-- these too (for managed Postgres), but only a superuser can, so a fresh
-- container does it up front.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
