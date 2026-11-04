import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { FAILED_NOTE, MAX_LIVE_PATCHES, MAX_PATCH_BYTES, TOKEN_PREFIX, findSecret, purgeAgentData } from './agent';

describe('secret scan', () => {
  it.each([
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nabc'],
    ['service account key', '{"private_key": "x"}'],
    ['AWS access key', 'key AKIAABCDEFGHIJKLMNOP here'],
    ['GitHub token', `token ghp_${'a'.repeat(36)}`],
    ['Slack token', 'xoxb-1234567890-abcdef'],
    ['LifeOS agent token', `${TOKEN_PREFIX}${'A'.repeat(30)}`],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij'],
    ['connection string with a password', 'postgres://user:hunter2@db.example.com/x'],
    ['credential assignment', 'password = "s3cr3t-value-here"'],
    ['credential assignment', 'API_KEY: abcdef123456'],
  ])('flags a %s', (kind, text) => { expect(findSecret(text)).toBe(kind); });

  it('leaves ordinary dbt and SQL alone', () => {
    const sql = `select o.id, o.customer_id from {{ ref('stg_orders') }} o
left join {{ ref('stg_customers') }} c on c.id = o.customer_id
where o.token_count > 0 and o.password_reset_at is null -- keep resets
{{ config(materialized='incremental', unique_key='id') }}`;
    expect(findSecret(sql)).toBeNull();
    expect(findSecret('dbt run -s stg_orders && dbt test -s stg_orders')).toBeNull();
  });
});

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

describe.skipIf(!reachable)('agent alerts API', () => {
  let server: Server;
  let base: string;
  let cookie = '';
  let token = '';

  const call = async (method: string, path: string, opts: { body?: unknown; agent?: boolean; anon?: boolean } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.agent) headers.authorization = `Bearer ${token}`;
    else if (!opts.anon && cookie) headers.cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const agent = (method: string, path: string, body?: unknown) => call(method, path, { agent: true, body });
  const alert = { externalId: 'rollbar-101', title: 'NULL customer_id in orders', category: 'data_quality', severity: 'high', occurrences: 40 };
  const patch = { title: 'Keep customers without an address', filePath: 'models/staging/stg_orders.sql', body: 'select * from x', testCommand: 'dbt test -s stg_orders' };
  const newAlert = async (over: object = {}) => (await agent('POST', '/api/agent/alerts', { ...alert, ...over })).body.id as string;

  beforeAll(async () => {
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    server = createApp({ pool }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    await call('POST', '/api/auth/register', { body: { email: 'me@example.com', password: 'correct horse battery' } });
    token = (await call('POST', '/api/agent/tokens', { body: { name: 'test' } })).body.token;
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('needs the right kind of credential on every route', async () => {
    expect((await call('GET', '/api/agent/alerts', { anon: true })).status).toBe(401);
    expect((await call('GET', '/api/agent/alerts', { agent: true })).status).toBe(401); // the agent cannot read back
    expect((await call('POST', '/api/agent/alerts', { body: alert })).status).toBe(401); // the session cannot write as the agent
    expect((await call('PATCH', '/api/agent/patches/1', { agent: true, body: { status: 'applied' } })).status).toBe(401);
  });

  it('creates an alert, then updates the same one by its Rollbar id', async () => {
    const id = await newAlert();
    expect(id).toBeTruthy();
    await agent('POST', `/api/agent/alerts/${id}/findings`, { text: 'Not a bug in the source' });
    const again = await agent('POST', '/api/agent/alerts', { ...alert, occurrences: 55, status: 'investigating', summary: 'Joins drop customers' });
    expect(again.body.id).toBe(id);
    const list = (await call('GET', '/api/agent/alerts')).body.alerts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, occurrences: 55, status: 'investigating', summary: 'Joins drop customers', category: 'data_quality' });
    // fields left out keep their value
    await agent('POST', '/api/agent/alerts', { ...alert, occurrences: 60 });
    const kept = (await call('GET', '/api/agent/alerts')).body.alerts[0];
    expect(kept).toMatchObject({ occurrences: 60, status: 'investigating', summary: 'Joins drop customers' });
  });

  it('validates alerts', async () => {
    const bad = async (over: object) => (await agent('POST', '/api/agent/alerts', { ...alert, ...over })).status;
    expect(await bad({ externalId: 'has spaces' })).toBe(400);
    expect(await bad({ title: '' })).toBe(400);
    expect(await bad({ title: 'x'.repeat(201) })).toBe(400);
    expect(await bad({ category: 'whatever' })).toBe(400);
    expect(await bad({ severity: 'catastrophic' })).toBe(400);
    expect(await bad({ status: 'dancing' })).toBe(400);
    expect(await bad({ occurrences: -1 })).toBe(400);
    expect(await bad({ occurrences: 1.5 })).toBe(400);
    expect(await bad({ summary: 'x'.repeat(2001) })).toBe(400);
    expect(await bad({ lastSeenAt: 'yesterday' })).toBe(400);
  });

  it('refuses text that looks like a credential, and stores nothing', async () => {
    const r = await agent('POST', '/api/agent/alerts', { ...alert, externalId: 'leaky', summary: 'connect with password = "hunter2hunter2"' });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toContain('hunter2');
    expect((await pool.query("SELECT 1 FROM agent_alerts WHERE external_id='leaky'")).rowCount).toBe(0);
    const id = await newAlert();
    expect((await agent('POST', `/api/agent/alerts/${id}/findings`, { text: 'key AKIAABCDEFGHIJKLMNOP' })).status).toBe(422);
    expect((await agent('POST', `/api/agent/alerts/${id}/patches`, { ...patch, body: '-----BEGIN PRIVATE KEY-----' })).status).toBe(422);
  });

  it('stores a fix, shows it to the owner and wipes its text once applied', async () => {
    const id = await newAlert();
    const p = await agent('POST', `/api/agent/alerts/${id}/patches`, patch);
    expect(p.status).toBe(201);
    const exp = new Date(p.body.expiresAt).getTime() - Date.now();
    expect(exp).toBeGreaterThan(6.9 * 86400_000);
    expect(exp).toBeLessThan(7.1 * 86400_000);
    expect((await call('GET', '/api/agent/alerts')).body.alerts.find((a: { id: string }) => a.id === id).openPatches).toBe(1);
    const detail = (await call('GET', `/api/agent/alerts/${id}`)).body;
    expect(detail.patches[0]).toMatchObject({ title: patch.title, filePath: patch.filePath, body: patch.body, testCommand: patch.testCommand, status: 'proposed' });

    expect((await call('PATCH', `/api/agent/patches/${p.body.id}`, { body: { status: 'maybe' } })).status).toBe(400);
    expect((await call('PATCH', `/api/agent/patches/${p.body.id}`, { body: { status: 'applied' } })).status).toBe(200);
    expect((await pool.query('SELECT body, status FROM agent_patches WHERE id=$1', [p.body.id])).rows[0]).toEqual({ body: '', status: 'applied' });
    expect((await call('PATCH', `/api/agent/patches/${p.body.id}`, { body: { status: 'ignored' } })).status).toBe(404); // already handled
    expect((await call('GET', '/api/agent/alerts')).body.alerts.find((a: { id: string }) => a.id === id).openPatches).toBe(0);
  });

  it('caps the size of a fix and the number waiting', async () => {
    const id = await newAlert();
    expect((await agent('POST', `/api/agent/alerts/${id}/patches`, { ...patch, body: 'a'.repeat(MAX_PATCH_BYTES + 1) })).status).toBe(413);
    expect((await agent('POST', `/api/agent/alerts/${id}/patches`, { ...patch, body: 'a'.repeat(MAX_PATCH_BYTES) })).status).toBe(201);
    expect((await agent('POST', `/api/agent/alerts/${id}/patches`, { ...patch, title: '' })).status).toBe(400);
    await pool.query('DELETE FROM agent_patches');
    for (let i = 0; i < MAX_LIVE_PATCHES; i++) expect((await agent('POST', `/api/agent/alerts/${id}/patches`, patch)).status).toBe(201);
    expect((await agent('POST', `/api/agent/alerts/${id}/patches`, patch)).status).toBe(409);
    await pool.query('DELETE FROM agent_patches');
  });

  it('deletes expired fixes and long-quiet alerts', async () => {
    const id = await newAlert({ externalId: 'old-one' });
    const p = (await agent('POST', `/api/agent/alerts/${id}/patches`, patch)).body.id;
    await pool.query("UPDATE agent_patches SET expires_at = now() - interval '1 minute' WHERE id=$1", [p]);
    await purgeAgentData(pool);
    expect((await pool.query('SELECT 1 FROM agent_patches WHERE id=$1', [p])).rowCount).toBe(0);
    await pool.query("UPDATE agent_alerts SET last_seen_at = now() - interval '91 days' WHERE id=$1", [id]);
    await purgeAgentData(pool);
    expect((await pool.query('SELECT 1 FROM agent_alerts WHERE id=$1', [id])).rowCount).toBe(0);
  });

  it('sorts open and severe alerts first', async () => {
    await pool.query('DELETE FROM agent_alerts');
    await newAlert({ externalId: 'a', severity: 'low' });
    await newAlert({ externalId: 'b', severity: 'critical' });
    await newAlert({ externalId: 'c', severity: 'critical', status: 'resolved' });
    await newAlert({ externalId: 'd', severity: 'medium' });
    const order = (await call('GET', '/api/agent/alerts')).body.alerts.map((a: { externalId: string }) => a.externalId);
    expect(order).toEqual(['b', 'd', 'a', 'c']);
  });

  it("does not show one account's alerts to another", async () => {
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('other@x.co','x') RETURNING id");
    const other = await pool.query(
      "INSERT INTO agent_alerts (user_id, external_id, title, category, severity) VALUES ($1,'theirs','secret','other','low') RETURNING id", [u.rows[0].id]);
    const pa = await pool.query(
      "INSERT INTO agent_patches (alert_id, title, file_path, body, expires_at) VALUES ($1,'t','f','b', now() + interval '1 day') RETURNING id", [other.rows[0].id]);
    expect((await call('GET', `/api/agent/alerts/${other.rows[0].id}`)).status).toBe(404);
    expect((await call('PATCH', `/api/agent/patches/${pa.rows[0].id}`, { body: { status: 'applied' } })).status).toBe(404);
    expect((await agent('POST', `/api/agent/alerts/${other.rows[0].id}/patches`, patch)).status).toBe(404);
    expect((await agent('POST', `/api/agent/alerts/${other.rows[0].id}/findings`, { text: 'hi' })).status).toBe(404);
    expect((await call('GET', '/api/agent/alerts')).body.alerts.some((a: { externalId: string }) => a.externalId === 'theirs')).toBe(false);
  });

  it('tells in the list what the agent found: causes, other notes, failed analyses, or nothing yet', async () => {
    await pool.query('DELETE FROM agent_alerts');
    const none = await newAlert({ externalId: 'n0' });
    const cause = await newAlert({ externalId: 'n1' });
    const note = await newAlert({ externalId: 'n2' });
    const failed = await newAlert({ externalId: 'n3' });
    await agent('POST', `/api/agent/alerts/${cause}/findings`, { kind: 'cause', text: 'a cause' });
    await agent('POST', `/api/agent/alerts/${note}/findings`, { kind: 'note', text: 'nothing conclusive' });
    await agent('POST', `/api/agent/alerts/${failed}/findings`, { kind: 'note', text: `${FAILED_NOTE} (timed out). Use Re-analyze to try again.` });
    const by = Object.fromEntries((await call('GET', '/api/agent/alerts')).body.alerts.map((a: { externalId: string }) => [a.externalId, a]));
    expect([by.n0, by.n1, by.n2, by.n3].map((a) => [a.causes, a.notes, a.failedNotes])).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(none).toBeTruthy();
  });

  it('deletes the simulated alerts with what hangs on them, and nobody else\'s', async () => {
    await pool.query('DELETE FROM agent_alerts');
    const sim = await newAlert({ externalId: 'sim-1', title: '[simulated] x' });
    await agent('POST', `/api/agent/alerts/${sim}/findings`, { kind: 'cause', text: 'demo' });
    await agent('POST', `/api/agent/alerts/${sim}/patches`, patch);
    await newAlert({ externalId: 'sim-2', title: '[simulated] y' });
    await newAlert({ externalId: 'rollbar-5', title: 'A real one' });
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('sim-owner@x.co','x') RETURNING id");
    await pool.query("INSERT INTO agent_alerts (user_id, external_id, title, category, severity) VALUES ($1,'sim-1','theirs','other','low')", [u.rows[0].id]);

    expect((await call('DELETE', '/api/agent/alerts/simulated', { anon: true, body: {} })).status).toBe(401);
    expect((await agent('DELETE', '/api/agent/alerts/simulated', {})).status).toBe(401); // the agent itself may not do this
    expect((await call('DELETE', '/api/agent/alerts/simulated', { body: {} })).body).toEqual({ deleted: 2 });
    expect((await call('GET', '/api/agent/alerts')).body.alerts.map((a: { externalId: string }) => a.externalId)).toEqual(['rollbar-5']);
    expect((await pool.query('SELECT 1 FROM agent_findings WHERE alert_id=$1', [sim])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM agent_patches WHERE alert_id=$1', [sim])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM agent_alerts WHERE user_id=$1 AND external_id='sim-1'", [u.rows[0].id])).rowCount).toBe(1);
    expect((await call('DELETE', '/api/agent/alerts/simulated', { body: {} })).body).toEqual({ deleted: 0 });
  });

  it('keeps fixes out of the account export', async () => {
    const id = await newAlert({ externalId: 'exp' });
    await agent('POST', `/api/agent/alerts/${id}/patches`, { ...patch, body: 'UNIQUE-PATCH-TEXT' });
    const res = await fetch(`${base}/api/account/export`, { headers: { cookie } });
    expect(await res.text()).not.toContain('UNIQUE-PATCH-TEXT');
  });
});
