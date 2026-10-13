import pg from 'pg';
import { assertTestDatabase, TEST_DATABASE_URL } from './testdb';
import { migrate } from '../server/db';

/** Starts every run from an empty lifeos_test (the API is not up yet at this point). */
export default async function globalSetup() {
  assertTestDatabase(TEST_DATABASE_URL);
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups, calendar_feeds, feed_events RESTART IDENTITY CASCADE');
  } catch (e) {
    throw new Error(`Cannot reach lifeos_test on localhost:5433 — run "npm run db:up" first. (${(e as Error).message})`);
  } finally {
    await pool.end();
  }
}
