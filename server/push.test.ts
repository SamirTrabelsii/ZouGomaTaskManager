import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { isValidTimeZone, zonedToInstant } from './time';
import { MAX_LATE_MS, runDueReminders, type PushPayload, type Sender } from './push';

describe('wall-clock reminder times', () => {
  it('converts a local time in a zone to the right instant', () => {
    // 09:30 in Paris in June is UTC+2
    expect(new Date(zonedToInstant('2026-06-10T09:30', 'Europe/Paris')!).toISOString()).toBe('2026-06-10T07:30:00.000Z');
    // ...and UTC+1 in January
    expect(new Date(zonedToInstant('2026-01-10T09:30', 'Europe/Paris')!).toISOString()).toBe('2026-01-10T08:30:00.000Z');
    expect(new Date(zonedToInstant('2026-06-10T09:30', 'America/New_York')!).toISOString()).toBe('2026-06-10T13:30:00.000Z');
    expect(new Date(zonedToInstant('2026-06-10T09:30', 'UTC')!).toISOString()).toBe('2026-06-10T09:30:00.000Z');
  });
  it('rejects malformed input and bad zones', () => {
    expect(zonedToInstant('tomorrow', 'UTC')).toBeNull();
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped */ }

const NOW = Date.UTC(2026, 5, 10, 8, 0, 0); // 10:00 in Paris
const doc = (reminders: object[]) => ({ version: 1, tasks: [], reminders, prefs: {} });
const rem = (id: string, at: string, extra: object = {}) => ({ id, title: `Do ${id}`, at, link: null, deliveredAt: null, deliveredVia: null, ackedAt: null, ...extra });

describe.skipIf(!reachable)('push reminders', () => {
  let sent: { endpoint: string; payload: PushPayload }[];
  let result: 'ok' | 'gone' | 'error';
  const send: Sender = async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload }); return result; };
  let userId: number;

  const setDoc = (reminders: object[]) => pool.query(
    `INSERT INTO documents (user_id, data, revision) VALUES ($1,$2,1) ON CONFLICT (user_id) DO UPDATE SET data=$2`, [userId, JSON.stringify(doc(reminders))]);
  const addSub = (endpoint: string, tz = 'Europe/Paris') => pool.query(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tz) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (endpoint) DO UPDATE SET tz=$5', [userId, endpoint, 'p', 'a', tz]);

  beforeAll(async () => {
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, sessions, documents, document_backups, push_subscriptions, push_sent RESTART IDENTITY CASCADE');
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('p@x.co','x') RETURNING id");
    userId = Number(u.rows[0].id);
    sent = []; result = 'ok';
  });
  afterAll(async () => { await pool.end(); });

  it('pushes a due reminder to every subscribed device, once', async () => {
    await addSub('https://push.example/a'); await addSub('https://push.example/b');
    await setDoc([rem('r1', '2026-06-10T09:59')]); // 07:59 UTC: due 1 minute ago in Paris time
    expect((await runDueReminders(pool, send, NOW)).sent).toBe(2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/a', 'https://push.example/b']);
    expect(sent[0].payload).toMatchObject({ title: 'LifeOS reminder', body: 'Do r1', tag: 'lifeos-r1' });
    await runDueReminders(pool, send, NOW + 60_000);
    expect(sent).toHaveLength(2); // not repeated
  });

  it('respects the user\'s time zone (not due yet in New York)', async () => {
    await addSub('https://push.example/a', 'America/New_York');
    await setDoc([rem('r1', '2026-06-10T09:59')]); // 13:59 UTC, still in the future at 08:00 UTC
    await runDueReminders(pool, send, NOW);
    expect(sent).toHaveLength(0);
  });

  it('does not push future, delivered or acknowledged reminders', async () => {
    await addSub('https://push.example/a');
    await setDoc([
      rem('future', '2026-06-10T10:30'),
      rem('done', '2026-06-10T09:00', { deliveredAt: '2026-06-10T07:00:00Z' }),
      rem('acked', '2026-06-10T09:00', { ackedAt: '2026-06-10T07:00:00Z' }),
    ]);
    await runDueReminders(pool, send, NOW);
    expect(sent).toHaveLength(0);
  });

  it('re-arms a snoozed reminder because its scheduled time changed', async () => {
    await addSub('https://push.example/a');
    await setDoc([rem('r1', '2026-06-10T09:00')]);
    await runDueReminders(pool, send, NOW);
    await setDoc([rem('r1', '2026-06-10T09:30')]);
    await runDueReminders(pool, send, NOW + 31 * 60_000 - 60 * 60_000 + 60 * 60_000);
    expect(sent).toHaveLength(2);
  });

  it('skips reminders missed by many hours but never fires them later', async () => {
    await addSub('https://push.example/a');
    await setDoc([rem('old', '2026-06-10T01:00')]); // 7+ hours before NOW
    await runDueReminders(pool, send, NOW);
    expect(sent).toHaveLength(0);
    await runDueReminders(pool, send, NOW + MAX_LATE_MS); // still nothing
    expect(sent).toHaveLength(0);
  });

  it('removes subscriptions the browser reports as gone', async () => {
    await addSub('https://push.example/dead');
    await setDoc([rem('r1', '2026-06-10T09:59')]);
    result = 'gone';
    await runDueReminders(pool, send, NOW);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
    expect(rows[0].n).toBe(0);
  });

  it('keeps the subscription on a transient send error', async () => {
    await addSub('https://push.example/flaky');
    await setDoc([rem('r1', '2026-06-10T09:59')]);
    result = 'error';
    await runDueReminders(pool, send, NOW);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions');
    expect(rows[0].n).toBe(1);
  });
});

describe.skipIf(!reachable)('push endpoints', () => {
  let base = '';
  let cookie = '';
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  const delivered: string[] = [];
  const p2 = createPool(URL_);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };

  beforeAll(async () => {
    await migrate(p2);
    await p2.query('TRUNCATE users, sessions, documents, document_backups, push_subscriptions, push_sent RESTART IDENTITY CASCADE');
    server = createApp({ pool: p2, push: { publicKey: 'PUBKEY', send: async (s) => { delivered.push(s.endpoint); return 'ok'; } } }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server.close(); await p2.end(); });

  const sub = { endpoint: 'https://fcm.example/send/abc', keys: { p256dh: 'pk', auth: 'ak' } };

  it('requires sign-in', async () => {
    expect((await call('GET', '/api/push/key')).status).toBe(401);
    expect((await call('POST', '/api/push/subscribe', { subscription: sub, tz: 'UTC' })).status).toBe(401);
  });

  it('serves the public key, stores a subscription, and validates input', async () => {
    await call('POST', '/api/auth/register', { email: 'push@example.com', password: 'a long enough password' });
    expect((await call('GET', '/api/push/key')).body).toEqual({ publicKey: 'PUBKEY' });
    expect((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://insecure', keys: sub.keys }, tz: 'UTC' })).status).toBe(400);
    expect((await call('POST', '/api/push/subscribe', { subscription: sub, tz: 'Nowhere/Land' })).status).toBe(400);
    expect((await call('POST', '/api/push/subscribe', { subscription: sub, tz: 'Europe/Paris' })).status).toBe(201);
    expect((await call('POST', '/api/push/subscribe', { subscription: sub, tz: 'Asia/Tokyo' })).status).toBe(201); // idempotent, updates tz
    const { rows } = await p2.query('SELECT tz FROM push_subscriptions');
    expect(rows).toEqual([{ tz: 'Asia/Tokyo' }]);
  });

  it('sends a test push to this user\'s devices', async () => {
    expect((await call('POST', '/api/push/test', {})).body).toEqual({ delivered: 1, devices: 1 });
    expect(delivered).toEqual([sub.endpoint]);
  });

  it('unsubscribes', async () => {
    expect((await call('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint })).status).toBe(200);
    expect((await call('POST', '/api/push/test', {})).status).toBe(409);
  });
});

describe('web-push sender', () => {
  const sub = async () => {
    const crypto = await import('node:crypto');
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    return { endpoint: 'https://push.example/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  };
  const payload = { title: 'LifeOS reminder', body: 'Stretch', tag: 'lifeos-r1', url: '/' };

  it('builds an encrypted, VAPID-signed request for the push service', async () => {
    const webpush = (await import('web-push')).default;
    const keys = webpush.generateVAPIDKeys();
    const s = await sub();
    webpush.setVapidDetails('mailto:test@example.com', keys.publicKey, keys.privateKey);
    const d = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
    expect(d.endpoint).toBe(s.endpoint);
    expect(d.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(d.headers.Authorization)).toMatch(/^vapid /);
    expect((d.body as Buffer).length).toBeGreaterThan(40);
    expect((d.body as Buffer).toString('utf8')).not.toContain('Stretch'); // encrypted
  });

  it('maps push-service answers: ok, 404/410 gone, anything else error', async () => {
    const webpush = (await import('web-push')).default;
    const { vi } = await import('vitest');
    const { makeWebPushSender } = await import('./push');
    const send = makeWebPushSender({ ...webpush.generateVAPIDKeys(), subject: 'mailto:test@example.com' });
    const s = await sub();
    const spy = vi.spyOn(webpush, 'sendNotification');
    spy.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });
    expect(await send(s, payload)).toBe('ok');
    spy.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect(await send(s, payload)).toBe('gone');
    spy.mockRejectedValueOnce(Object.assign(new Error('missing'), { statusCode: 404 }));
    expect(await send(s, payload)).toBe('gone');
    spy.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }));
    expect(await send(s, payload)).toBe('error');
    spy.mockRestore();
  });
});
