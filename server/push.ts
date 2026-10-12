import webpush from 'web-push';
import type pg from 'pg';
import { zonedToInstant } from './time';

/** Reminders missed by more than this are not pushed (they show in the app instead). Mirrors the in-app rule. */
export const MAX_LATE_MS = 6 * 3600_000;

export interface PushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
}

export interface PushPayload { title: string; body: string; tag: string; url: string }

/** Sends one push. Resolves 'gone' when the browser says the subscription no longer exists. */
export type Sender = (sub: Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>, payload: PushPayload) => Promise<'ok' | 'gone' | 'error'>;

export const PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS server_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  tz         TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
-- one row per (reminder, scheduled time): snoozing changes "at", which re-arms it
CREATE TABLE IF NOT EXISTS push_sent (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL,
  at          TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reminder_id, at)
);
`;

/** VAPID keys come from the environment, else are generated once and kept in the database. */
export async function loadVapid(pool: pg.Pool): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@lifeos.local';
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject };
  }
  const { rows } = await pool.query("SELECT key, value FROM server_settings WHERE key IN ('vapid_public','vapid_private')");
  const get = (k: string) => rows.find((r) => r.key === k)?.value as string | undefined;
  if (get('vapid_public') && get('vapid_private')) return { publicKey: get('vapid_public')!, privateKey: get('vapid_private')!, subject };
  const keys = webpush.generateVAPIDKeys();
  await pool.query(
    "INSERT INTO server_settings (key, value) VALUES ('vapid_public',$1),('vapid_private',$2) ON CONFLICT (key) DO NOTHING",
    [keys.publicKey, keys.privateKey]);
  // another process may have won the race; read back what is actually stored
  const again = await pool.query("SELECT key, value FROM server_settings WHERE key IN ('vapid_public','vapid_private')");
  const g = (k: string) => again.rows.find((r) => r.key === k)!.value as string;
  return { publicKey: g('vapid_public'), privateKey: g('vapid_private'), subject };
}

export function makeWebPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): Sender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: 'high' });
      return 'ok';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'gone' : 'error';
    }
  };
}

interface StoredReminder { id?: unknown; title?: unknown; at?: unknown; deliveredAt?: unknown; ackedAt?: unknown }

/**
 * Finds reminders that are due for users with push subscriptions and pushes each exactly once per scheduled time.
 * Reads the synced document; it never writes to it (that would create sync conflicts for the user's devices).
 */
export async function runDueReminders(pool: pg.Pool, send: Sender, now = Date.now()): Promise<{ sent: number }> {
  const { rows: subs } = await pool.query<PushSubscriptionRow>('SELECT id, user_id, endpoint, p256dh, auth, tz FROM push_subscriptions');
  if (!subs.length) return { sent: 0 };
  const byUser = new Map<number, PushSubscriptionRow[]>();
  for (const s of subs) byUser.set(Number(s.user_id), [...(byUser.get(Number(s.user_id)) ?? []), s]);

  let sent = 0;
  for (const [userId, userSubs] of byUser) {
    const doc = await pool.query('SELECT data FROM documents WHERE user_id=$1', [userId]);
    const reminders: StoredReminder[] = Array.isArray(doc.rows[0]?.data?.reminders) ? doc.rows[0].data.reminders : [];
    const tz = userSubs[0].tz; // reminders are wall-clock in the user's zone; the newest registration wins
    for (const r of reminders) {
      if (typeof r.id !== 'string' || typeof r.at !== 'string' || typeof r.title !== 'string') continue;
      if (r.deliveredAt || r.ackedAt) continue; // the app already handled it
      const due = zonedToInstant(r.at, tz);
      if (due === null || due > now) continue;
      // claim first, so overlapping runs can't double-send
      const claim = await pool.query(
        'INSERT INTO push_sent (user_id, reminder_id, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [userId, r.id, r.at]);
      if (!claim.rowCount) continue;
      if (now - due > MAX_LATE_MS) continue; // stale: claimed so it never fires later, but no popup
      const payload: PushPayload = { title: 'LifeOS reminder', body: r.title.slice(0, 200), tag: `lifeos-${r.id}`, url: '/' };
      for (const s of userSubs) {
        const res = await send(s, payload);
        if (res === 'gone') await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [s.id]);
        else if (res === 'ok') sent++;
      }
    }
  }
  // keep the dedupe table small
  await pool.query("DELETE FROM push_sent WHERE sent_at < now() - interval '30 days'");
  return { sent };
}

export function startScheduler(pool: pg.Pool, send: Sender, everyMs = 30_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runDueReminders(pool, send); } catch (e) { console.error('push scheduler:', e); } finally { running = false; }
  };
  const id = setInterval(tick, everyMs);
  void tick();
  return () => clearInterval(id);
}
