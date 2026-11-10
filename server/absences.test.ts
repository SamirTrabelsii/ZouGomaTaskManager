import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { STALE_STEP_MINUTES } from './absences';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

const SETTINGS = {
  employer: { to: ['boss@employer.test'], cc: ['hr@employer.test'] },
  client: { to: ['lead@client.test'], cc: [] },
  planningName: 'Samir',
};

describe.skipIf(!reachable)('absences API', () => {
  let server: Server;
  let base: string;
  let cookie = '';
  let token = '';

  const call = async (method: string, path: string, opts: { body?: unknown; agent?: boolean; anon?: boolean; as?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.agent) headers.authorization = `Bearer ${token}`;
    else if (!opts.anon) headers.cookie = opts.as ?? cookie;
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set && !opts.as) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const owner = (method: string, path: string, body?: unknown) => call(method, path, { body });
  const exec = (method: string, path: string, body?: unknown) => call(method, path, { agent: true, body });
  const book = (days: unknown, steps: string[] = ['mail_employer', 'mail_client']) => owner('POST', '/api/absences', { days, steps });
  const work = async (kinds = 'mail_employer,mail_client,planning') => (await exec('GET', `/api/absences/work?kinds=${kinds}`)).body.steps as {
    id: string; kind: string; absence: { id: string; label: string; windows: unknown; planning: { name: string; cells: unknown[] } }; mail?: { to: string[]; subject: string; text: string; html: string };
  }[];

  beforeAll(async () => {
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    server = createApp({ pool }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    await call('POST', '/api/auth/register', { body: { email: 'me@example.com', password: 'correct horse battery' } });
    token = (await owner('POST', '/api/agent/tokens', { name: 'n8n' })).body.token;
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM absences');
    await owner('PUT', '/api/absences/settings', SETTINGS);
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('keeps the two sides apart', async () => {
    expect((await call('GET', '/api/absences', { anon: true })).status).toBe(401);
    expect((await call('GET', '/api/absences', { agent: true })).status).toBe(401); // the executor cannot read the owner's list
    expect((await call('POST', '/api/absences', { agent: true, body: { days: [], steps: [] } })).status).toBe(401);
    expect((await call('GET', '/api/absences/work?kinds=planning')).status).toBe(401); // a session cannot act as the executor
  });

  it('validates settings', async () => {
    expect((await owner('PUT', '/api/absences/settings', { ...SETTINGS, employer: { to: ['not a mail'], cc: [] } })).status).toBe(400);
    expect((await owner('PUT', '/api/absences/settings', { ...SETTINGS, client: { to: 'x@y.test' } })).status).toBe(400);
    expect((await owner('GET', '/api/absences/settings')).body).toEqual(SETTINGS);
  });

  it('validates a booking', async () => {
    expect((await book([])).status).toBe(400);
    expect((await book([{ date: '2026-11-13', part: 'full' }], ['send_everything'])).status).toBe(400);
    expect((await book([{ date: '2026-11-13', part: 'full' }], [])).status).toBe(400);
    await owner('PUT', '/api/absences/settings', { ...SETTINGS, planningName: '' });
    expect((await book([{ date: '2026-11-13', part: 'full' }], ['planning'])).body.error).toMatch(/planning/);
  });

  it('runs a booking from the room to each result', async () => {
    const created = await book([{ date: '2026-11-13', part: 'full' }, { date: '2026-11-12', part: 'pm' }], ['mail_employer', 'mail_client', 'planning']);
    expect(created.status).toBe(201);
    expect(created.body.label).toBe('le jeudi 12 novembre 2026 après-midi et le vendredi 13 novembre 2026');

    const steps = await work();
    expect(steps.map((s) => s.kind)).toEqual(['mail_employer', 'mail_client', 'planning']);
    const mail = steps[0].mail!;
    expect(mail.to).toEqual(['boss@employer.test']);
    expect(mail.text).toContain('je serai absent du bureau le jeudi 12 novembre 2026 après-midi et le vendredi 13 novembre 2026.');
    expect(mail.html).toContain('<div>Bonjour,</div>');
    expect(steps[2].mail).toBeUndefined();
    expect(steps[2].absence.planning).toEqual({ name: 'Samir', cells: [{ date: '2026-11-13', value: 'Absent' }] });
    expect(steps[0].absence.windows).toEqual([{ start: '2026-11-12T13:00', end: '2026-11-14T00:00' }]);

    expect((await exec('POST', `/api/absences/steps/${steps[0].id}/start`, {})).status).toBe(200);
    expect((await exec('POST', `/api/absences/steps/${steps[0].id}/start`, {})).status).toBe(409); // never twice
    expect((await work()).map((s) => s.kind)).toEqual(['mail_client', 'planning']);
    expect((await exec('POST', `/api/absences/steps/${steps[0].id}/result`, { status: 'done', detail: 'Envoyé' })).status).toBe(200);
    expect((await exec('POST', `/api/absences/steps/${steps[1].id}/result`, { status: 'failed', detail: 'Gmail refused' })).status).toBe(200);
    expect((await exec('POST', `/api/absences/steps/${steps[1].id}/result`, { status: 'done' })).status).toBe(409); // already finished

    const list = (await owner('GET', '/api/absences')).body;
    expect(list.executor.online).toBe(true);
    expect(list.executor.kinds).toEqual(['mail_employer', 'mail_client', 'planning']);
    expect(list.absences[0].steps.map((s: { status: string }) => s.status)).toEqual(['done', 'failed', 'pending']);

    // a failed step can be run again; a done one cannot
    expect((await owner('POST', `/api/absences/steps/${steps[1].id}/retry`, {})).status).toBe(200);
    expect((await owner('POST', `/api/absences/steps/${steps[0].id}/retry`, {})).status).toBe(409);
    expect((await work()).map((s) => s.kind)).toEqual(['mail_client', 'planning']);
    // and an absence with work done cannot be cancelled
    expect((await owner('POST', `/api/absences/${created.body.id}/cancel`, {})).status).toBe(409);
  });

  it('only hands out the kinds an executor asks for', async () => {
    await book([{ date: '2026-11-13', part: 'full' }], ['mail_employer', 'planning']);
    expect((await work('planning')).map((s) => s.kind)).toEqual(['planning']);
    expect((await exec('GET', '/api/absences/work?kinds=rm')).status).toBe(400);
  });

  it('refuses a day already booked, and cancels an untouched absence', async () => {
    const a = await book([{ date: '2026-11-13', part: 'full' }]);
    expect((await book([{ date: '2026-11-13', part: 'am' }])).status).toBe(409);
    expect((await owner('POST', `/api/absences/${a.body.id}/cancel`, {})).status).toBe(200);
    expect(await work()).toEqual([]);
    expect((await book([{ date: '2026-11-13', part: 'am' }])).status).toBe(201); // the day is free again
    expect((await owner('DELETE', `/api/absences/${a.body.id}`, {})).status).toBe(200);
  });

  it('marks a step that never answered as failed instead of running it again', async () => {
    await book([{ date: '2026-11-13', part: 'full' }], ['mail_employer']);
    const [step] = await work();
    await exec('POST', `/api/absences/steps/${step.id}/start`, {});
    await pool.query(`UPDATE absence_steps SET started_at = now() - interval '${STALE_STEP_MINUTES + 1} minutes'`);
    expect(await work()).toEqual([]);
    const s = (await owner('GET', '/api/absences')).body.absences[0].steps[0];
    expect(s.status).toBe('failed');
    expect(s.detail).toMatch(/by hand/);
  });

  it('refuses a result that looks like a credential', async () => {
    await book([{ date: '2026-11-13', part: 'full' }], ['mail_employer']);
    const [step] = await work();
    expect((await exec('POST', `/api/absences/steps/${step.id}/result`, { status: 'failed', detail: 'password=hunter2hunter2' })).status).toBe(422);
  });

  it("does not let one account see or run another's absences", async () => {
    const u = await pool.query("INSERT INTO users (email, password_hash) VALUES ('other@x.co','x') RETURNING id");
    const a = await pool.query(
      `INSERT INTO absences (user_id, days, label, first_day, last_day, payload)
       VALUES ($1, '[{"date":"2026-11-20","part":"full"}]', 'theirs', '2026-11-20', '2026-11-20', '{"mails":[],"windows":[],"planning":{}}') RETURNING id`, [u.rows[0].id]);
    const st = await pool.query("INSERT INTO absence_steps (absence_id, kind, status) VALUES ($1,'mail_employer','failed') RETURNING id", [a.rows[0].id]);
    const stepId = String(st.rows[0].id);
    expect((await owner('GET', '/api/absences')).body.absences).toEqual([]);
    expect((await owner('POST', `/api/absences/steps/${stepId}/retry`, {})).status).toBe(409);
    expect((await owner('POST', `/api/absences/${a.rows[0].id}/cancel`, {})).status).toBe(404);
    expect((await owner('DELETE', `/api/absences/${a.rows[0].id}`, {})).status).toBe(409);
    await pool.query("UPDATE absence_steps SET status='pending' WHERE id=$1", [stepId]);
    expect(await work()).toEqual([]);
    expect((await exec('POST', `/api/absences/steps/${stepId}/start`, {})).status).toBe(409);
    expect((await exec('POST', `/api/absences/steps/${stepId}/result`, { status: 'done' })).status).toBe(409);
    expect((await book([{ date: '2026-11-20', part: 'full' }])).status).toBe(201); // their days do not block mine
    await pool.query('DELETE FROM users WHERE id=$1', [u.rows[0].id]);
  });
});
