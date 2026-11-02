import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { MAX_ACTIVE_TOKENS, TOKEN_PREFIX, newAgentToken } from './agent';

describe('agent tokens', () => {
  it('are long, random and prefixed', () => {
    const a = newAgentToken();
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(TOKEN_PREFIX.length + 40);
    expect(newAgentToken()).not.toBe(a);
  });
});

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

describe.skipIf(!reachable)('agent API', () => {
  let server: Server;
  let base: string;
  let cookie = '';

  const call = async (method: string, path: string, opts: { body?: unknown; bearer?: string; cookie?: boolean } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.cookie !== false && cookie) headers.cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  /** Frees the slots first, so tests do not trip over the per-account token limit. */
  const newToken = async (name = 'laptop') => {
    await pool.query('UPDATE agent_tokens SET revoked_at=now() WHERE revoked_at IS NULL');
    const r = await call('POST', '/api/agent/tokens', { body: { name } });
    expect(r.status).toBe(201);
    return r.body as { id: string; token: string; hint: string };
  };

  beforeAll(async () => {
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    server = createApp({ pool }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    await call('POST', '/api/auth/register', { body: { email: 'me@example.com', password: 'correct horse battery' } });
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('needs a signed-in session to manage tokens', async () => {
    expect((await call('GET', '/api/agent', { cookie: false })).status).toBe(401);
    expect((await call('POST', '/api/agent/tokens', { cookie: false, body: { name: 'x' } })).status).toBe(401);
  });

  it('shows the token once and stores only its hash', async () => {
    const t = await newToken('work laptop');
    expect(t.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t.hint).toBe(t.token.slice(-4));
    const { rows } = await pool.query('SELECT token_hash FROM agent_tokens');
    expect(rows[0].token_hash).not.toContain(t.token);
    const list = (await call('GET', '/api/agent')).body;
    expect(list.tokens).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(t.token);
    expect(list.online).toBe(false);
  });

  it('validates the token name', async () => {
    expect((await call('POST', '/api/agent/tokens', { body: { name: '  ' } })).status).toBe(400);
    expect((await call('POST', '/api/agent/tokens', { body: { name: 'x'.repeat(41) } })).status).toBe(400);
    expect((await call('POST', '/api/agent/tokens', { body: {} })).status).toBe(400);
  });

  it('accepts a heartbeat with a valid token and reports the agent online', async () => {
    const t = await newToken('hb');
    const r = await call('POST', '/api/agent/heartbeat', { cookie: false, bearer: t.token, body: { version: '0.1.0', state: 'working' } });
    expect(r.status).toBe(200);
    const s = (await call('GET', '/api/agent')).body;
    expect(s).toMatchObject({ online: true, version: '0.1.0', state: 'working' });
    const used = await pool.query('SELECT last_used_at FROM agent_tokens WHERE id=$1', [t.id]);
    expect(used.rows[0].last_used_at).not.toBeNull();
  });

  it('ignores an unknown state and caps the version length', async () => {
    const t = await newToken('odd');
    await call('POST', '/api/agent/heartbeat', { cookie: false, bearer: t.token, body: { version: 'v'.repeat(500), state: 'hacking' } });
    const s = (await call('GET', '/api/agent')).body;
    expect(s.state).toBe('idle');
    expect(s.version).toHaveLength(40);
  });

  it('rejects missing, malformed and unknown tokens', async () => {
    const heartbeat = (bearer?: string) => call('POST', '/api/agent/heartbeat', { cookie: false, bearer, body: {} });
    expect((await heartbeat()).status).toBe(401);
    expect((await heartbeat('not-a-token')).status).toBe(401);
    expect((await heartbeat(newAgentToken())).status).toBe(401);
  });

  it('does not let the session cookie act as the agent, nor the token act as the user', async () => {
    const t = await newToken('iso');
    expect((await call('POST', '/api/agent/heartbeat', { body: {} })).status).toBe(401); // cookie only
    for (const [m, p] of [['GET', '/api/data'], ['GET', '/api/agent'], ['GET', '/api/auth/me'], ['GET', '/api/account/export']] as const) {
      expect((await call(m, p, { cookie: false, bearer: t.token })).status).toBe(401);
    }
  });

  it('stops working once the token is revoked', async () => {
    const t = await newToken('temp');
    expect((await call('POST', '/api/agent/heartbeat', { cookie: false, bearer: t.token, body: {} })).status).toBe(200);
    expect((await call('DELETE', `/api/agent/tokens/${t.id}`, { body: {} })).status).toBe(200);
    expect((await call('POST', '/api/agent/heartbeat', { cookie: false, bearer: t.token, body: {} })).status).toBe(401);
    expect((await call('DELETE', `/api/agent/tokens/${t.id}`, { body: {} })).status).toBe(404);
    expect((await call('DELETE', '/api/agent/tokens/abc', { body: {} })).status).toBe(404);
  });

  it(`allows at most ${MAX_ACTIVE_TOKENS} active tokens`, async () => {
    const { tokens } = (await call('GET', '/api/agent')).body as { tokens: { id: string }[] };
    for (const t of tokens) await call('DELETE', `/api/agent/tokens/${t.id}`, { body: {} });
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) expect((await call('POST', '/api/agent/tokens', { body: { name: `t${i}` } })).status).toBe(201);
    expect((await call('POST', '/api/agent/tokens', { body: { name: 'one too many' } })).status).toBe(409);
  });
});
