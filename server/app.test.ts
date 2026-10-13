import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';

// These tests need a real PostgreSQL (docker compose up -d db). They are skipped when it is unreachable.
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

const data = (n: number) => ({ version: 1, tasks: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` })), prefs: {} });

describe.skipIf(!reachable)('LifeOS API', () => {
  let server: Server;
  let base: string;
  let cookie = '';
  let recovery = '';

  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  beforeAll(async () => {
    // These tests TRUNCATE every table: refuse to run against anything that isn't a dedicated *_test database.
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    server = createApp({ pool }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('requires sign-in for data', async () => {
    cookie = '';
    expect((await call('GET', '/api/data')).status).toBe(401);
    expect((await call('PUT', '/api/data', { data: data(1), baseRevision: 0 })).status).toBe(401);
  });

  it('reports that registration is open on a fresh server', async () => {
    expect((await call('GET', '/api/health')).body).toMatchObject({ ok: true, hasUser: false, registrationOpen: true });
  });

  it('validates registration input', async () => {
    expect((await call('POST', '/api/auth/register', { email: 'nope', password: 'longenoughpassword' })).status).toBe(400);
    expect((await call('POST', '/api/auth/register', { email: 'a@b.co', password: 'short' })).status).toBe(400);
  });

  it('registers the single user, sets an HttpOnly session cookie and stores no plaintext password', async () => {
    const r = await call('POST', '/api/auth/register', { email: 'Me@Example.com', password: 'correct horse battery' });
    expect(r.status).toBe(201);
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(r.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
    const { rows } = await pool.query('SELECT email, password_hash FROM users');
    expect(rows[0].email).toBe('me@example.com');
    expect(rows[0].password_hash).not.toContain('correct horse');
    const tok = await pool.query('SELECT token_hash FROM sessions');
    expect(cookie).not.toContain(tok.rows[0].token_hash); // only a hash of the token is stored
    expect((await call('GET', '/api/auth/me')).body).toEqual({ email: 'me@example.com', hasRecoveryCode: true });
    // a recovery code is shown once at creation; only a hash is stored
    recovery = r.body.recoveryCode;
    expect(recovery).toMatch(/^([A-HJKMNP-Z2-9]{4}-){4}[A-HJKMNP-Z2-9]{4}$/);
    const u = await pool.query('SELECT recovery_hash FROM users');
    expect(u.rows[0].recovery_hash).toBeTruthy();
    expect(u.rows[0].recovery_hash).not.toContain(recovery.replaceAll('-', ''));
  });

  it('refuses a second account unless registration is enabled', async () => {
    const r = await call('POST', '/api/auth/register', { email: 'other@example.com', password: 'another long password' });
    expect(r.status).toBe(403);
  });

  it('starts with no data, then saves and reads it back with a revision', async () => {
    expect((await call('GET', '/api/data')).body).toEqual({ data: null, revision: 0 });
    const put = await call('PUT', '/api/data', { data: data(2), baseRevision: 0 });
    expect(put.body).toEqual({ revision: 1 });
    const got = await call('GET', '/api/data');
    expect(got.body.revision).toBe(1);
    expect(got.body.data.tasks).toHaveLength(2);
  });

  it('rejects malformed data', async () => {
    expect((await call('PUT', '/api/data', { data: { tasks: [] }, baseRevision: 1 })).status).toBe(400);
    expect((await call('PUT', '/api/data', { data: data(1) })).status).toBe(400);
  });

  it('detects conflicts instead of silently overwriting, and returns the server copy', async () => {
    const ok = await call('PUT', '/api/data', { data: data(3), baseRevision: 1 });
    expect(ok.body.revision).toBe(2);
    const stale = await call('PUT', '/api/data', { data: data(9), baseRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.revision).toBe(2);
    expect(stale.body.data.tasks).toHaveLength(3);
    expect((await call('GET', '/api/data')).body.data.tasks).toHaveLength(3); // unchanged
  });

  it('keeps a backup of the replaced copy when forced to overwrite', async () => {
    const forced = await call('PUT', '/api/data', { data: data(9), baseRevision: 1, force: true });
    expect(forced.body.revision).toBe(3);
    const list = await call('GET', '/api/data/backups');
    const b = list.body.backups.find((x: { reason: string }) => x.reason === 'before overwrite');
    expect(b).toBeTruthy();
    const full = await call('GET', `/api/data/backups/${b.id}`);
    expect(full.body.data.tasks).toHaveLength(3);
  });

  it('blocks cross-origin writes and non-JSON writes', async () => {
    expect((await call('PUT', '/api/data', { data: data(1), baseRevision: 3 }, { origin: 'https://evil.example' })).status).toBe(403);
    const res = await fetch(base + '/api/data', { method: 'PUT', headers: { 'content-type': 'text/plain', cookie }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('logs out and invalidates the session', async () => {
    const saved = cookie;
    expect((await call('POST', '/api/auth/logout', {})).status).toBe(200);
    cookie = saved;
    expect((await call('GET', '/api/data')).status).toBe(401);
  });

  it('rejects a wrong password, then signs in, and rate-limits repeated failures', async () => {
    cookie = '';
    expect((await call('POST', '/api/auth/login', { email: 'me@example.com', password: 'wrong password!!' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { email: 'me@example.com', password: 'correct horse battery' })).status).toBe(200);
    expect((await call('GET', '/api/data')).body.revision).toBe(3);
    cookie = '';
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/login', { email: 'brute@example.com', password: 'guess-' + i })).status;
    expect(last).toBe(429);
  }, 60_000);

  /* ── password change, recovery code, export (each step builds on the previous state) ── */
  const OLD_PW = 'correct horse battery';
  const NEW_PW = 'a brand new passphrase';
  const login = async (password: string, email = 'me@example.com') => {
    cookie = '';
    const r = await call('POST', '/api/auth/login', { email, password });
    return { r, cookie };
  };

  it('changes the password, ends other sessions but keeps this one', async () => {
    const a = (await login(OLD_PW)).cookie;
    const b = (await login(OLD_PW)).cookie;
    cookie = a;
    expect((await call('POST', '/api/auth/change-password', { currentPassword: 'not it at all', newPassword: NEW_PW })).status).toBe(403);
    expect((await call('POST', '/api/auth/change-password', { currentPassword: OLD_PW, newPassword: 'short' })).status).toBe(400);
    expect((await call('POST', '/api/auth/change-password', { currentPassword: OLD_PW, newPassword: OLD_PW })).status).toBe(400);
    expect((await call('POST', '/api/auth/change-password', { currentPassword: OLD_PW })).status).toBe(400);
    const ok = await call('POST', '/api/auth/change-password', { currentPassword: OLD_PW, newPassword: NEW_PW });
    expect(ok.status).toBe(200);
    expect(ok.body.otherSessionsEnded).toBeGreaterThanOrEqual(1);
    cookie = a;
    expect((await call('GET', '/api/auth/me')).status).toBe(200); // this device stays signed in
    cookie = b;
    expect((await call('GET', '/api/auth/me')).status).toBe(401); // the other one is out
    expect((await login(OLD_PW)).r.status).toBe(401);
    expect((await login(NEW_PW)).r.status).toBe(200);
  }, 60_000);

  it('rejects a bad recovery code the same way for known and unknown emails, and rate-limits guesses', async () => {
    cookie = '';
    const wrong = 'AAAA-AAAA-AAAA-AAAA-AAAA';
    const known = await call('POST', '/api/auth/reset-password', { email: 'me@example.com', recoveryCode: wrong, newPassword: 'whatever password' });
    const unknown = await call('POST', '/api/auth/reset-password', { email: 'nobody@example.com', recoveryCode: wrong, newPassword: 'whatever password' });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(known.body).toEqual(unknown.body);
    expect((await call('POST', '/api/auth/reset-password', { email: 'me@example.com', recoveryCode: recovery })).status).toBe(400);
    expect((await call('POST', '/api/auth/reset-password', { email: 'me@example.com', recoveryCode: recovery, newPassword: 'short' })).status).toBe(400);
    expect((await login(NEW_PW)).r.status).toBe(200); // nothing changed
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/reset-password', { email: 'guesser@example.com', recoveryCode: wrong, newPassword: 'whatever password' })).status;
    expect(last).toBe(429);
  }, 60_000);

  it('resets a forgotten password with the recovery code: single use, ends every session, returns a new code', async () => {
    const before = (await login(NEW_PW)).cookie;
    cookie = '';
    const FORGOT = 'my reset passphrase';
    const r = await call('POST', '/api/auth/reset-password', { email: 'ME@example.com', recoveryCode: recovery.toLowerCase().replaceAll('-', ' '), newPassword: FORGOT });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect(r.body.recoveryCode).not.toBe(recovery);
    expect((await call('GET', '/api/data')).status).toBe(200); // the reset signs this device in
    cookie = before;
    expect((await call('GET', '/api/auth/me')).status).toBe(401); // old sessions are gone
    expect((await login(NEW_PW)).r.status).toBe(401);
    expect((await login(FORGOT)).r.status).toBe(200);
    // the used code is dead
    cookie = '';
    expect((await call('POST', '/api/auth/reset-password', { email: 'me@example.com', recoveryCode: recovery, newPassword: 'yet another one!' })).status).toBe(401);
    recovery = r.body.recoveryCode;
  }, 60_000);

  it('issues a replacement recovery code only with the password', async () => {
    await login('my reset passphrase');
    expect((await call('POST', '/api/auth/recovery-code', { password: 'nope' })).status).toBe(403);
    const r = await call('POST', '/api/auth/recovery-code', { password: 'my reset passphrase' });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCode).not.toBe(recovery);
    cookie = '';
    expect((await call('POST', '/api/auth/reset-password', { email: 'me@example.com', recoveryCode: recovery, newPassword: 'yet another one!' })).status).toBe(401); // superseded
    recovery = r.body.recoveryCode;
    cookie = '';
    expect((await call('POST', '/api/auth/recovery-code', { password: 'my reset passphrase' })).status).toBe(401);
  }, 60_000);

  it('exports everything stored for the account, and nothing secret or foreign', async () => {
    cookie = '';
    expect((await call('GET', '/api/account/export')).status).toBe(401);
    await login('my reset passphrase');
    const me = (await pool.query("SELECT id, password_hash, recovery_hash FROM users WHERE email='me@example.com'")).rows[0];
    await pool.query("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tz) VALUES ($1,'https://push.example/abc','P256DH-SECRET','AUTH-SECRET','Africa/Tunis')", [me.id]);
    // a second user's data must never leak into this export
    const other = (await pool.query("INSERT INTO users (email, password_hash) VALUES ('other@example.com','x') RETURNING id")).rows[0];
    await pool.query('INSERT INTO documents (user_id, data) VALUES ($1,$2)', [other.id, JSON.stringify({ version: 1, tasks: [{ id: 'z', title: 'OTHER-USERS-TASK' }] })]);

    const res = await fetch(base + '/api/account/export', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="lifeos-account-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const out = JSON.parse(text);
    expect(out).toMatchObject({ format: 'lifeos-account-export', formatVersion: 1, account: { email: 'me@example.com', hasRecoveryCode: true } });
    expect(out.data.revision).toBe(3);
    expect(out.data.data.tasks).toHaveLength(9);
    expect(out.backups.length).toBeGreaterThanOrEqual(1);
    expect(out.backups[0].data.version).toBe(1);
    expect(out.pushSubscriptions).toEqual([expect.objectContaining({ endpoint: 'https://push.example/abc', timeZone: 'Africa/Tunis' })]);
    expect(out.activeSessions.length).toBeGreaterThanOrEqual(1);
    for (const secret of [me.password_hash, me.recovery_hash, 'P256DH-SECRET', 'AUTH-SECRET', 'OTHER-USERS-TASK', 'other@example.com']) expect(text).not.toContain(secret);
    const tok = await pool.query('SELECT token_hash FROM sessions WHERE user_id=$1', [me.id]);
    for (const t of tok.rows) expect(text).not.toContain(t.token_hash);
  }, 60_000);

  it('requires sign-in to change the password and rate-limits wrong current passwords', async () => {
    cookie = '';
    expect((await call('POST', '/api/auth/change-password', { currentPassword: 'my reset passphrase', newPassword: OLD_PW })).status).toBe(401);
    await login('my reset passphrase');
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await call('POST', '/api/auth/change-password', { currentPassword: 'wrong-' + i, newPassword: OLD_PW })).status;
    expect(last).toBe(429);
    // even the right password is refused while limited
    expect((await call('POST', '/api/auth/change-password', { currentPassword: 'my reset passphrase', newPassword: OLD_PW })).status).toBe(429);
  }, 60_000);
});

describe.skipIf(!reachable)('static hosting', () => {
  it('serves the built app and falls back to index.html for client routes', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>LifeOS</title>');
    const p = createPool(URL_);
    const srv = createApp({ pool: p, staticDir: dir }).listen(0);
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(b + '/')).text()).toContain('LifeOS');
      expect(await (await fetch(b + '/some/client/route')).text()).toContain('LifeOS');
      expect((await fetch(b + '/api/nope')).status).toBe(404);
    } finally { srv.close(); await p.end(); }
  });
});
