import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, notes: 'secret notes', status: 'todo', priority: 'medium', size: null, dueDate: null, projectId: null,
  milestoneId: null, goalId: null, scopeId: null, blockedBy: '', resumeOn: null, createdAt: '2026-11-01T08:00:00.000Z', completedAt: null, ...extra,
});

describe.skipIf(!reachable)('browser extension API', () => {
  let server: Server;
  let base: string;
  let cookie = '';
  let token = '';
  let agentToken = '';
  let revision = 0;

  const call = async (method: string, path: string, opts: { body?: unknown; bearer?: string; anon?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    else if (!opts.anon) headers.cookie = cookie;
    if (opts.origin) headers.origin = opts.origin;
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const owner = (method: string, path: string, body?: unknown) => call(method, path, { body });
  const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  const ext = (method: string, path: string, body?: unknown) => call(method, path, { body, bearer: token, origin: ORIGIN });
  const saved = async () => (await pool.query('SELECT data, revision FROM documents')).rows[0] as { data: { tasks: ReturnType<typeof task>[] }; revision: number };

  beforeAll(async () => {
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    server = createApp({ pool }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    await call('POST', '/api/auth/register', { body: { email: 'me@example.com', password: 'correct horse battery' } });
    token = (await owner('POST', '/api/extension/tokens', { name: 'Chrome' })).body.token;
    agentToken = (await owner('POST', '/api/agent/tokens', { name: 'agent' })).body.token;
  });
  beforeEach(async () => {
    const recent = new Date(Date.now() - 3600_000).toISOString();
    const old = new Date(Date.now() - 5 * 86400_000).toISOString();
    const data = {
      version: 4,
      tasks: [task('a', { dueDate: '2026-11-12' }), task('b', { status: 'blocked', blockedBy: 'waiting on IT' }),
        task('c', { status: 'done', completedAt: recent }), task('d', { status: 'done', completedAt: old })],
      scopes: [{ id: 's1', title: 'Work', icon: '💼', color: '#62b4ff', createdAt: old }],
      projects: [{ id: 'p1', title: 'Migration', description: '', status: 'active', deadline: null, createdAt: old }],
      notes: [{ id: 'n1', title: 'private' }],
    };
    const cur = (await owner('GET', '/api/data')).body.revision as number;
    revision = (await owner('PUT', '/api/data', { data, baseRevision: cur, force: true })).body.revision;
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('keeps the token scopes apart', async () => {
    expect((await call('GET', '/api/extension/tasks', { anon: true })).status).toBe(401);
    // a signed-in cookie is not enough: the task routes want the bearer token
    expect((await owner('GET', '/api/extension/tasks')).status).toBe(401);
    // an agent token does not open the task routes, and a task token opens nothing of the agent's
    expect((await call('GET', '/api/extension/tasks', { bearer: agentToken })).status).toBe(401);
    expect((await call('POST', '/api/agent/heartbeat', { bearer: token, body: {} })).status).toBe(401);
    expect((await call('GET', '/api/absences/work?kinds=planning', { bearer: token })).status).toBe(401);
    // the extension tokens are listed apart from the agent's
    expect((await owner('GET', '/api/extension/tokens')).body.tokens.map((t: { name: string }) => t.name)).toEqual(['Chrome']);
    expect((await owner('GET', '/api/agent')).body.tokens.map((t: { name: string }) => t.name)).toEqual(['agent']);
  });

  it('lists open tasks and recently done ones, without notes or other data', async () => {
    const r = await ext('GET', '/api/extension/tasks');
    expect(r.status).toBe(200);
    expect(r.body.tasks.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c']);
    expect(r.body.tasks[0]).not.toHaveProperty('notes');
    expect(r.body.scopes).toEqual([{ id: 's1', title: 'Work', icon: '💼', color: '#62b4ff' }]);
    expect(r.body.projects).toEqual([{ id: 'p1', title: 'Migration' }]);
    expect(r.body).not.toHaveProperty('notes');
    expect(r.body.revision).toBe(revision);
  });

  it('adds a task at the top and bumps the revision', async () => {
    const r = await ext('POST', '/api/extension/tasks', { title: '  Call the bank  ', dueDate: '2026-11-13', priority: 'high', scopeId: 's1' });
    expect(r.status).toBe(201);
    expect(r.body.task).toMatchObject({ title: 'Call the bank', status: 'todo', priority: 'high', dueDate: '2026-11-13', scopeId: 's1' });
    const s = await saved();
    expect(s.revision).toBe(revision + 1);
    expect(s.data.tasks[0]).toMatchObject({ id: r.body.task.id, notes: '', size: null, completedAt: null, blockedBy: '' });
    expect(s.data.tasks).toHaveLength(5);
    // the rest of the document is untouched
    expect((s.data as unknown as { notes: unknown[] }).notes).toHaveLength(1);
    // an unknown scope is dropped rather than stored
    expect((await ext('POST', '/api/extension/tasks', { title: 'x', scopeId: 'nope' })).body.task.scopeId).toBeNull();
  });

  it('rejects bad input', async () => {
    expect((await ext('POST', '/api/extension/tasks', { title: '   ' })).status).toBe(400);
    expect((await ext('POST', '/api/extension/tasks', { title: 'x'.repeat(201) })).status).toBe(400);
    expect((await ext('POST', '/api/extension/tasks', { title: 'x', dueDate: '2026-02-30' })).status).toBe(400);
    expect((await ext('POST', '/api/extension/tasks', { title: 'x', priority: 'urgent' })).status).toBe(400);
    expect((await ext('PATCH', '/api/extension/tasks/a', { status: 'archived' })).status).toBe(400);
    expect((await ext('PATCH', '/api/extension/tasks/a', {})).status).toBe(400);
    expect((await ext('PATCH', '/api/extension/tasks/a', { title: ' ' })).status).toBe(400);
    expect((await ext('PATCH', '/api/extension/tasks/a', { resumeOn: 'soon' })).status).toBe(400);
    expect((await ext('POST', '/api/extension/tasks', { title: 'x', notes: 'n'.repeat(2001) })).status).toBe(400);
    expect((await ext('DELETE', '/api/extension/tasks/zzz', {})).status).toBe(404);
    expect((await ext('PATCH', '/api/extension/tasks/zzz', { status: 'done' })).status).toBe(404);
    expect((await saved()).revision).toBe(revision);
  });

  it('ticks a task off and back, with the app’s rules', async () => {
    const done = await ext('PATCH', '/api/extension/tasks/b', { status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.task.completedAt).toBeTruthy();
    let t = (await saved()).data.tasks.find((x) => x.id === 'b')!;
    expect(t).toMatchObject({ status: 'done', blockedBy: '' });
    const again = await ext('PATCH', '/api/extension/tasks/b', { status: 'done' });
    expect(again.body.revision).toBe(revision + 1); // no-op: nothing written
    await ext('PATCH', '/api/extension/tasks/b', { status: 'todo' });
    t = (await saved()).data.tasks.find((x) => x.id === 'b')!;
    expect(t).toMatchObject({ status: 'todo', completedAt: null });
  });

  it('keeps a captured page link in the notes and shows only the link', async () => {
    const r = await ext('POST', '/api/extension/tasks', { title: 'Read this', notes: 'From: https://example.com/a?b=1 selected text' });
    expect(r.body.task.link).toBe('https://example.com/a?b=1');
    expect(r.body.task).not.toHaveProperty('notes');
    expect((await saved()).data.tasks[0].notes).toBe('From: https://example.com/a?b=1 selected text');
  });

  it('edits a task with the app’s rules and keeps its reminder title in step', async () => {
    const reminders = [{ id: 'r1', title: 'Task a', at: '2026-11-12T09:00', link: { type: 'task', id: 'a' }, deliveredAt: null, deliveredVia: null, ackedAt: null }];
    await pool.query("UPDATE documents SET data = jsonb_set(data, '{reminders}', $1::jsonb)", [JSON.stringify(reminders)]);
    const r = await ext('PATCH', '/api/extension/tasks/a', { title: 'Renamed', dueDate: null, priority: 'high', scopeId: 's1', status: 'blocked', blockedBy: 'waiting on Bob' });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ title: 'Renamed', dueDate: null, priority: 'high', scopeId: 's1', status: 'blocked', blockedBy: 'waiting on Bob' });
    let s = await saved();
    expect((s.data as unknown as { reminders: { title: string }[] }).reminders[0].title).toBe('Renamed');
    // on hold drops the blocked note and keeps the resume date
    await ext('PATCH', '/api/extension/tasks/a', { status: 'onhold', resumeOn: '2026-12-01' });
    s = await saved();
    expect(s.data.tasks.find((x) => x.id === 'a')).toMatchObject({ status: 'onhold', blockedBy: '', resumeOn: '2026-12-01' });
    // an unknown scope is ignored
    await ext('PATCH', '/api/extension/tasks/a', { scopeId: 'nope' });
    expect((await saved()).data.tasks.find((x) => x.id === 'a')!.scopeId).toBe('s1');
  });

  it('deletes a task and its reminder', async () => {
    const reminders = [{ id: 'r1', title: 'Task a', at: '2026-11-12T09:00', link: { type: 'task', id: 'a' } }, { id: 'r2', title: 'other', at: '2026-11-12T09:00', link: null }];
    await pool.query("UPDATE documents SET data = jsonb_set(data, '{reminders}', $1::jsonb)", [JSON.stringify(reminders)]);
    const r = await ext('DELETE', '/api/extension/tasks/a', {});
    expect(r.status).toBe(200);
    const s = await saved();
    expect(s.data.tasks.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect((s.data as unknown as { reminders: { id: string }[] }).reminders.map((x) => x.id)).toEqual(['r2']);
  });

  it('makes the app see the change through the revision', async () => {
    expect((await owner('GET', '/api/data/revision')).body.revision).toBe(revision);
    await ext('PATCH', '/api/extension/tasks/a', { status: 'doing' });
    expect((await owner('GET', '/api/data/revision')).body.revision).toBe(revision + 1);
    // the app's next save from the old revision is a conflict, not a silent overwrite
    const stale = await owner('PUT', '/api/data', { data: { version: 4, tasks: [] }, baseRevision: revision });
    expect(stale.status).toBe(409);
  });

  it('still blocks cookie requests from foreign origins', async () => {
    expect((await call('PUT', '/api/data', { body: { data: { version: 4 }, baseRevision: revision }, origin: ORIGIN })).status).toBe(403);
  });
});
