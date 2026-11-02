import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { MAX_PENDING_COMMANDS, purgeAgentData } from './agent';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

describe.skipIf(!reachable)('agent commands API', () => {
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
  const order = (body: unknown) => call('POST', '/api/agent/commands', { body });
  const newAlert = async (externalId = 'rb-1') =>
    (await agent('POST', '/api/agent/alerts', { externalId, title: 'Broken join', category: 'data_quality', severity: 'high' })).body.id as string;
  const pending = async () => (await agent('GET', '/api/agent/commands/pending')).body.commands as { id: string; kind: string; externalId: string | null }[];
  const reset = () => pool.query('DELETE FROM agent_commands');

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

  it('keeps the two sides apart', async () => {
    const alertId = await newAlert();
    expect((await call('POST', '/api/agent/commands', { anon: true, body: { kind: 'pause' } })).status).toBe(401);
    expect((await call('POST', '/api/agent/commands', { agent: true, body: { kind: 'pause' } })).status).toBe(401); // the agent cannot give itself orders
    expect((await call('GET', '/api/agent/commands', { agent: true })).status).toBe(401);
    expect((await call('GET', '/api/agent/commands/pending')).status).toBe(401); // the session cannot act as the agent
    const { body } = await order({ kind: 'investigate', alertId });
    expect((await call('POST', `/api/agent/commands/${body.id}/ack`, { body: {} })).status).toBe(401);
    expect((await call('POST', `/api/agent/commands/${body.id}/result`, { body: { status: 'done' } })).status).toBe(401);
    expect((await call('POST', `/api/agent/commands/${body.id}/cancel`, { agent: true, body: {} })).status).toBe(401);
    await reset();
  });

  it('only accepts orders from the closed list, with the right target', async () => {
    const alertId = await newAlert();
    expect((await order({ kind: 'rm -rf /' })).status).toBe(400);
    expect((await order({})).status).toBe(400);
    expect((await order({ kind: 'investigate' })).status).toBe(404); // needs an alert
    expect((await order({ kind: 'investigate', alertId: '999999' })).status).toBe(404);
    expect((await order({ kind: 'investigate', alertId: 'abc' })).status).toBe(404);
    expect((await order({ kind: 'pause', alertId })).status).toBe(400); // whole-agent orders take no target
    expect((await order({ kind: 'pause' })).status).toBe(201);
    expect((await order({ kind: 'resume' })).status).toBe(201);
    await reset();
  });

  it('runs an order from request to result', async () => {
    const alertId = await newAlert('rb-flow');
    const made = await order({ kind: 'investigate', alertId });
    expect(made.status).toBe(201);

    const waiting = await pending();
    expect(waiting).toEqual([expect.objectContaining({ id: made.body.id, kind: 'investigate', alertId, externalId: 'rb-flow' })]);
    expect(await pending()).toHaveLength(1); // reading does not consume it

    expect((await agent('POST', `/api/agent/commands/${made.body.id}/ack`, {})).status).toBe(200);
    expect((await agent('POST', `/api/agent/commands/${made.body.id}/ack`, {})).status).toBe(200); // repeating is harmless
    expect(await pending()).toHaveLength(0);
    expect((await call('GET', '/api/agent/commands')).body.commands[0]).toMatchObject({ id: made.body.id, status: 'acked', alertTitle: 'Broken join' });

    expect((await agent('POST', `/api/agent/commands/${made.body.id}/result`, { status: 'done', result: 'Cause found: left join drops rows' })).status).toBe(200);
    expect((await call('GET', '/api/agent/commands')).body.commands[0]).toMatchObject({ status: 'done', result: 'Cause found: left join drops rows' });
    expect((await agent('POST', `/api/agent/commands/${made.body.id}/result`, { status: 'failed' })).status).toBe(409); // already finished
    expect((await agent('POST', `/api/agent/commands/${made.body.id}/ack`, {})).status).toBe(409);
    await reset();
  });

  it('can report a result without acknowledging first, and a failure', async () => {
    const alertId = await newAlert();
    const { body } = await order({ kind: 'reanalyze', alertId });
    expect((await agent('POST', `/api/agent/commands/${body.id}/result`, { status: 'failed', result: 'BigQuery timed out' })).status).toBe(200);
    expect((await call('GET', '/api/agent/commands')).body.commands[0].status).toBe('failed');
    await reset();
  });

  it('validates results and refuses ones that look like a credential', async () => {
    const alertId = await newAlert();
    const { body } = await order({ kind: 'reanalyze', alertId });
    const send = (b: unknown) => agent('POST', `/api/agent/commands/${body.id}/result`, b);
    expect((await send({ status: 'weird' })).status).toBe(400);
    expect((await send({ status: 'done', result: 'x'.repeat(501) })).status).toBe(400);
    const leak = await send({ status: 'done', result: 'password = "hunter2hunter2"' });
    expect(leak.status).toBe(422);
    expect(JSON.stringify(leak.body)).not.toContain('hunter2');
    expect((await agent('POST', '/api/agent/commands/999999/result', { status: 'done' })).status).toBe(409);
    expect((await agent('POST', '/api/agent/commands/999999/ack', {})).status).toBe(404);
    await reset();
  });

  it('does not queue the same order twice', async () => {
    const alertId = await newAlert();
    const first = await order({ kind: 'investigate', alertId });
    const second = await order({ kind: 'investigate', alertId });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, alreadyQueued: true });
    expect((await order({ kind: 'reanalyze', alertId })).status).toBe(201); // a different order is fine
    await agent('POST', `/api/agent/commands/${first.body.id}/result`, { status: 'done' });
    expect((await order({ kind: 'investigate', alertId })).status).toBe(201); // once finished it can be asked again
    await reset();
  });

  it('marks an alert ignored at once when ignoring', async () => {
    const alertId = await newAlert('rb-ignore');
    await order({ kind: 'ignore', alertId });
    const alerts = (await call('GET', '/api/agent/alerts')).body.alerts as { id: string; status: string }[];
    expect(alerts.find((a) => a.id === alertId)?.status).toBe('ignored');
    expect((await pending())[0]).toMatchObject({ kind: 'ignore', externalId: 'rb-ignore' });
    await reset();
  });

  it('lets the owner take back an order the agent has not picked up', async () => {
    const { body } = await order({ kind: 'pause' });
    expect((await call('POST', `/api/agent/commands/${body.id}/cancel`, { body: {} })).status).toBe(200);
    expect(await pending()).toHaveLength(0);
    expect((await agent('POST', `/api/agent/commands/${body.id}/ack`, {})).status).toBe(409);
    expect((await call('POST', `/api/agent/commands/${body.id}/cancel`, { body: {} })).status).toBe(404); // already cancelled
    const taken = await order({ kind: 'resume' });
    await agent('POST', `/api/agent/commands/${taken.body.id}/ack`, {});
    expect((await call('POST', `/api/agent/commands/${taken.body.id}/cancel`, { body: {} })).status).toBe(404); // too late
    await reset();
  });

  it('tells the agent on its heartbeat how many orders wait', async () => {
    const beat = async () => (await agent('POST', '/api/agent/heartbeat', { state: 'idle' })).body.pendingCommands;
    expect(await beat()).toBe(0);
    await order({ kind: 'pause' });
    expect(await beat()).toBe(1);
    await reset();
  });

  it('drops orders nobody picked up within a day', async () => {
    const { body } = await order({ kind: 'pause' });
    await pool.query("UPDATE agent_commands SET created_at = now() - interval '25 hours' WHERE id=$1", [body.id]);
    expect(await pending()).toHaveLength(0); // stale orders are not handed out even before the purge runs
    await purgeAgentData(pool);
    expect((await call('GET', '/api/agent/commands')).body.commands[0].status).toBe('expired');
    await pool.query("UPDATE agent_commands SET created_at = now() - interval '31 days' WHERE id=$1", [body.id]);
    await purgeAgentData(pool);
    expect((await call('GET', '/api/agent/commands')).body.commands).toHaveLength(0);
  });

  it('limits how many orders can wait', async () => {
    for (let i = 0; i < MAX_PENDING_COMMANDS; i++) {
      const id = await newAlert(`bulk-${i}`);
      expect((await order({ kind: 'investigate', alertId: id })).status).toBe(201);
    }
    const extra = await newAlert('bulk-extra');
    expect((await order({ kind: 'investigate', alertId: extra })).status).toBe(409);
    await reset();
  });

  it("does not let one account order work on another's alert", async () => {
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('other@x.co','x') RETURNING id");
    const theirs = await pool.query(
      "INSERT INTO agent_alerts (user_id, external_id, title, category, severity) VALUES ($1,'theirs','t','other','low') RETURNING id", [u.rows[0].id]);
    expect((await order({ kind: 'investigate', alertId: String(theirs.rows[0].id) })).status).toBe(404);
  });
});
