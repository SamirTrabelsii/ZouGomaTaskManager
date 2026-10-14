import pg from 'pg';
import { PUSH_SCHEMA } from './push';
import { FEEDS_SCHEMA } from './feeds';

const DEV_URL = 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos';

/** In development the docker-compose database is the default; production must set DATABASE_URL. */
export function createPool(url = process.env.DATABASE_URL ?? (process.env.NODE_ENV === 'production' ? undefined : DEV_URL)) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({
    connectionString: url,
    max: 5,
    // a scale-to-zero host (Neon) needs a moment to wake on the first query
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
  });
}

/** Idempotent schema. One row of app data per user, plus rotating server-side backups. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS documents (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS document_backups (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason   TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data     JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_backups_user_idx ON document_backups(user_id, saved_at DESC);
`;

export async function migrate(pool: pg.Pool) {
  await pool.query(SCHEMA);
  await pool.query(PUSH_SCHEMA);
  await pool.query(FEEDS_SCHEMA);
}
