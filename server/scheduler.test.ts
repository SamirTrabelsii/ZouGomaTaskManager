import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, migrate } from './db';
import { nextFeedReminderAt, nextFeedSyncAt } from './feeds';
import { nextReminderAt } from './push';
import { startScheduler } from './scheduler';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped */ }

const NOW = Date.UTC(2026, 5, 10, 8, 0, 0); // 10:00 in Paris
const rem = (id: string, at: string, extra: object = {}) => ({ id, title: id, at, deliveredAt: null, ackedAt: null, ...extra });

describe.skipIf(!reachable)('scheduler planning', () => {
  let userId: number;
  beforeAll(async () => {
    if (!/_test$/.test(new URL(URL_).pathname.replace(/^\//, ''))) throw new Error('Refusing to run destructive tests on a non-test database');
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, sessions, documents, document_backups, push_subscriptions, push_sent, calendar_feeds, feed_events RESTART IDENTITY CASCADE');
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('s@x.co','x') RETURNING id");
    userId = Number(u.rows[0].id);
  });
  afterAll(async () => { await pool.end(); });

  const sub = () => pool.query("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tz) VALUES ($1,'https://p/a','p','a','Europe/Paris')", [userId]);
  const setDoc = (reminders: object[]) => pool.query('INSERT INTO documents (user_id, data, revision) VALUES ($1,$2,1)', [userId, JSON.stringify({ version: 1, tasks: [], reminders, prefs: {} })]);

  it('finds nothing to wait for without devices or reminders', async () => {
    expect(await nextReminderAt(pool, NOW)).toBeNull();
    await sub();
    expect(await nextReminderAt(pool, NOW)).toBeNull();
  });

  it('picks the earliest future, unhandled reminder', async () => {
    await sub();
    await setDoc([
      rem('past', '2026-06-10T09:00'),                                   // already due: the runner handles it
      rem('done', '2026-06-10T10:30', { ackedAt: 1 }),                   // handled
      rem('later', '2026-06-10T14:00'), rem('soon', '2026-06-10T11:15'),  // 09:15 UTC
    ]);
    expect(new Date((await nextReminderAt(pool, NOW))!).toISOString()).toBe('2026-06-10T09:15:00.000Z');
  });

  it('plans calendar syncs from the oldest attempt', async () => {
    expect(await nextFeedSyncAt(pool, 60_000)).toBeNull();
    await pool.query("INSERT INTO calendar_feeds (user_id, name, color, url, last_attempt_at) VALUES ($1,'a','#112233','https://x/a.ics',$2)", [userId, new Date(NOW)]);
    expect(await nextFeedSyncAt(pool, 60_000)).toBe(NOW + 60_000);
    await pool.query("INSERT INTO calendar_feeds (user_id, name, color, url) VALUES ($1,'b','#112233','https://x/b.ics')", [userId]);
    expect(await nextFeedSyncAt(pool, 60_000)).toBeLessThan(NOW); // a never-synced feed is due immediately
  });

  it('plans meeting reminders at start minus lead', async () => {
    await sub();
    const f = await pool.query("INSERT INTO calendar_feeds (user_id, name, color, url, remind_before) VALUES ($1,'a','#112233','https://x/a.ics',10) RETURNING id", [userId]);
    await pool.query(
      "INSERT INTO feed_events (feed_id, uid, occ, title, location, starts, ends, all_day) VALUES ($1,'u','o','Standup','', '2026-06-10T12:00:00Z','2026-06-10T12:30:00Z', false)", [f.rows[0].id]);
    expect(new Date((await nextFeedReminderAt(pool, NOW))!).toISOString()).toBe('2026-06-10T11:50:00.000Z');
    expect(await nextFeedReminderAt(pool, Date.UTC(2026, 5, 10, 11, 55))).toBeNull(); // lead window already open
  });

  it('runs once on start and re-plans on poke', async () => {
    const sent: string[] = [];
    await sub();
    await setDoc([rem('now', new Date(Date.now() - 60_000).toISOString().slice(0, 16))]);
    const s = startScheduler(pool, async (_s, p) => { sent.push(p.body); return 'ok'; }, async () => '', { minSleepMs: 50 });
    await new Promise((r) => setTimeout(r, 1500));
    s.poke();
    await new Promise((r) => setTimeout(r, 1000));
    s.stop();
    expect(sent.length).toBeLessThanOrEqual(1); // never double-sent, however often it ran
  });
});
