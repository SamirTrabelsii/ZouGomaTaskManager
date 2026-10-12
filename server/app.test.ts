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
    expect((await call('GET', '/api/auth/me')).body).toEqual({ email: 'me@example.com' });
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
