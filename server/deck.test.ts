import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { parseDeck } from './deck';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

const applause = { id: 'b1', label: 'Applause', icon: '👏', color: '#C0392B', action: { type: 'sound', file: 'applause.wav', volume: 70 } };
const capture = { id: 'b2', label: 'Capture', icon: '📸', color: '#2e86de', action: { type: 'app', target: 'ms-screenclip:' } };
const lifeos = { id: 'b3', label: 'LifeOS', icon: '🏠', color: '#4f7a52', action: { type: 'website', url: 'https://example.com/', browser: 'chrome', profile: 'Default' } };

describe('parseDeck', () => {
  it('keeps a valid layout and normalises it', () => {
    const r = parseDeck({ columns: 3, buttons: [applause, capture, lifeos] });
    expect(typeof r).toBe('object');
    const d = r as Exclude<typeof r, string>;
    expect(d.buttons[0].color).toBe('#c0392b');
    expect(d.buttons[2].action).toEqual({ type: 'website', url: 'https://example.com/', browser: 'chrome', profile: 'Default' });
  });

  it('accepts program paths and shortcuts', () => {
    for (const target of ['C:\\Program Files\\Spotify\\Spotify.exe', 'C:\\Users\\me\\Desktop\\Teams.lnk', 'ms-settings:display']) {
      expect(typeof parseDeck({ columns: 4, buttons: [{ ...capture, action: { type: 'app', target } }] })).toBe('object');
    }
  });

  it.each([
    ['a script with a folder', { type: 'script', file: '..\\evil.ps1' }],
    ['a script with arguments', { type: 'script', file: 'run.ps1 -Force' }],
    ['a script of another kind', { type: 'script', file: 'run.exe' }],
    ['a sound with a folder', { type: 'sound', file: 'C:\\x\\a.wav' }],
    ['a web link as an app', { type: 'app', target: 'https://example.com' }],
    ['a file link as an app', { type: 'app', target: 'file:///C:/Windows/System32/cmd.exe' }],
    ['a relative program path', { type: 'app', target: 'cmd.exe' }],
    ['a program with arguments', { type: 'app', target: 'C:\\Windows\\System32\\cmd.exe /c del' }],
    ['a website without https', { type: 'website', url: 'javascript:alert(1)' }],
    ['a bad Chrome profile', { type: 'website', url: 'https://a.b', browser: 'chrome', profile: '--disable-web-security' }],
    ['an unknown action', { type: 'shell', command: 'calc' }],
  ])('refuses %s', (_name, action) => {
    expect(typeof parseDeck({ columns: 4, buttons: [{ ...applause, action }] })).toBe('string');
  });

  it('refuses bad layouts', () => {
    expect(parseDeck({ columns: 1, buttons: [] })).toMatch(/Columns/);
    expect(parseDeck({ columns: 4, buttons: Array.from({ length: 33 }, (_, i) => ({ ...applause, id: `x${i}` })) })).toMatch(/at most/);
    expect(parseDeck({ columns: 4, buttons: [{ ...applause, label: '' }] })).toMatch(/label/);
    expect(parseDeck({ columns: 4, buttons: [{ ...applause, color: 'red' }] })).toMatch(/colour/);
  });

  it('gives duplicate ids a new one', () => {
    const d = parseDeck({ columns: 4, buttons: [applause, { ...capture, id: 'b1' }] }) as { buttons: { id: string }[] };
    expect(d.buttons[0].id).toBe('b1');
    expect(d.buttons[1].id).not.toBe('b1');
  });
});

describe.skipIf(!reachable)('stream deck API', () => {
  let server: Server;
  let base: string;
  let cookie = '';
  let deckToken = '';
  let agentToken = '';

  const call = async (method: string, path: string, opts: { body?: unknown; bearer?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    else headers.cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };

  beforeAll(async () => {
    const dbName = new URL(URL_).pathname.replace(/^\//, '');
    if (!/_test$/.test(dbName)) throw new Error(`Refusing to run destructive API tests on database "${dbName}"`);
    await migrate(pool);
    await pool.query('TRUNCATE users, sessions, documents, document_backups RESTART IDENTITY CASCADE');
    const fetchCardImage = async (url: string) => {
      if (url.endsWith('/OP01-001.jpg')) return { type: 'image/jpeg', body: Buffer.from('jpeg-bytes') };
      throw Object.assign(new Error('nope'), { status: 404 });
    };
    server = createApp({ pool, fetchCardImage }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
    await call('POST', '/api/auth/register', { body: { email: 'me@example.com', password: 'correct horse battery' } });
    deckToken = (await call('POST', '/api/deck/tokens', { body: { name: 'Office PC' } })).body.token;
    agentToken = (await call('POST', '/api/agent/tokens', { body: { name: 'agent' } })).body.token;
  });
  afterAll(async () => { server?.close(); await pool.end(); });

  it('starts empty', async () => {
    const r = await call('GET', '/api/deck');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ columns: 4, buttons: [], revision: 0, deck: { syncedAt: null, scripts: [], sounds: [] } });
    expect(r.body.tokens).toHaveLength(1);
  });

  it('saves a layout and bumps the revision', async () => {
    const r = await call('PUT', '/api/deck', { body: { columns: 3, buttons: [applause, capture] } });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(1);
    const again = await call('PUT', '/api/deck', { body: { columns: 3, buttons: [applause, capture, lifeos] } });
    expect(again.body.revision).toBe(2);
    expect((await call('PUT', '/api/deck', { body: { columns: 3, buttons: [{ ...applause, action: { type: 'script', file: 'a.ps1 -x' } }] } })).status).toBe(400);
  });

  it('the deck syncs with its token: reports its files, gets the buttons', async () => {
    const r = await call('POST', '/api/deck/sync', { bearer: deckToken, body: {
      version: '0.1.0', scripts: ['backup.ps1', '../x.ps1', 'b.exe'], sounds: ['applause.wav'],
      chromeProfiles: [{ dir: 'Profile 2', name: 'Perso', account: 's…@example.com' }, { dir: 'Default', name: 'Other', account: 'someone@example.com' }, { dir: '--x', name: 'bad' }],
    } });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(2);
    expect(r.body.buttons.map((b: { label: string }) => b.label)).toEqual(['Applause', 'Capture', 'LifeOS']);
    const o = await call('GET', '/api/deck');
    expect(o.body.deck).toMatchObject({ syncedRevision: 2, version: '0.1.0', scripts: ['backup.ps1'], sounds: ['applause.wav'] });
    // a full address is never stored, and a folder that reads as a switch is dropped
    expect(o.body.deck.chromeProfiles).toEqual([{ dir: 'Profile 2', name: 'Perso', account: 's…@example.com' }, { dir: 'Default', name: 'Other', account: '' }]);
    expect(o.body.deck.syncedAt).toBeTruthy();
  });

  it('a change after the sync shows as not yet on the PC', async () => {
    await call('PUT', '/api/deck', { body: { columns: 4, buttons: [applause] } });
    const o = await call('GET', '/api/deck');
    expect(o.body.revision).toBe(3);
    expect(o.body.deck.syncedRevision).toBe(2);
  });

  it('a deck token opens nothing else, and other tokens do not open the deck', async () => {
    expect((await call('GET', '/api/deck', { bearer: deckToken })).status).toBe(401);
    expect((await call('PUT', '/api/deck', { bearer: deckToken, body: { columns: 4, buttons: [] } })).status).toBe(401);
    expect((await call('GET', '/api/absences', { bearer: deckToken })).status).toBe(401);
    expect((await call('POST', '/api/agent/heartbeat', { bearer: deckToken, body: {} })).status).toBe(401);
    expect((await call('POST', '/api/deck/sync', { bearer: agentToken, body: {} })).status).toBe(401);
    expect((await call('POST', '/api/deck/sync', { body: {} })).status).toBe(401);
  });

  it('a revoked token stops working', async () => {
    const t = await call('POST', '/api/deck/tokens', { body: { name: 'spare' } });
    await call('DELETE', `/api/deck/tokens/${t.body.id}`, { body: {} });
    expect((await call('POST', '/api/deck/sync', { bearer: t.body.token, body: {} })).status).toBe(401);
  });

  const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(32)]);
  const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

  it('uploads sounds and scripts, checking what they really are', async () => {
    let r = await call('PUT', '/api/deck/files/sound/cheer.wav', { body: { data: b64(wav) } });
    expect(r.status).toBe(200);
    expect(r.body.files).toEqual([expect.objectContaining({ kind: 'sound', name: 'cheer.wav', size: wav.length })]);
    r = await call('PUT', '/api/deck/files/script/hello.ps1', { body: { data: b64('Write-Output "hello"\n') } });
    expect(r.status).toBe(200);
    expect(r.body.files.map((f: { name: string }) => f.name)).toEqual(['hello.ps1', 'cheer.wav']);

    expect((await call('PUT', '/api/deck/files/sound/fake.mp3', { body: { data: b64('not really an mp3') } })).body.error).toMatch(/not a real/);
    expect((await call('PUT', '/api/deck/files/script/run.exe', { body: { data: b64('x') } })).status).toBe(400);
    expect((await call('PUT', '/api/deck/files/script/bin.ps1', { body: { data: b64(Buffer.from([0x4d, 0x5a, 0, 1])) } })).body.error).toMatch(/plain text/);
    expect((await call('PUT', '/api/deck/files/script/secret.ps1', { body: { data: b64('$password = "hunter2hunter2"') } })).body.error).toMatch(/secrets/);
    expect((await call('PUT', '/api/deck/files/script/big.ps1', { body: { data: b64('#'.repeat(70 * 1024)) } })).body.error).toMatch(/at most/);
    expect((await call('PUT', '/api/deck/files/other/x.wav', { body: { data: b64(wav) } })).status).toBe(404);
    // only the deck's token downloads, and only the owner uploads
    expect((await call('PUT', '/api/deck/files/sound/x.wav', { bearer: deckToken, body: { data: b64(wav) } })).status).toBe(401);
  });

  it('the deck gets the file list at sync, then downloads what it lacks', async () => {
    const s = await call('POST', '/api/deck/sync', { bearer: deckToken, body: {} });
    expect(s.body.files).toEqual([
      expect.objectContaining({ kind: 'script', name: 'hello.ps1' }),
      expect.objectContaining({ kind: 'sound', name: 'cheer.wav', size: wav.length }),
    ]);
    const res = await fetch(`${base}/api/deck/files/sound/cheer.wav`, { headers: { authorization: `Bearer ${deckToken}` } });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(wav)).toBe(true);
    expect(res.headers.get('x-content-sha256')).toBe(s.body.files[1].sha256);
    expect((await fetch(`${base}/api/deck/files/sound/cheer.wav`, { headers: { cookie } })).status).toBe(401);
    expect((await fetch(`${base}/api/deck/files/sound/nope.wav`, { headers: { authorization: `Bearer ${deckToken}` } })).status).toBe(404);
  });

  it('deletes a file', async () => {
    const r = await call('DELETE', '/api/deck/files/script/hello.ps1', { body: {} });
    expect(r.body.files.map((f: { name: string }) => f.name)).toEqual(['cheer.wav']);
    expect((await call('DELETE', '/api/deck/files/script/hello.ps1', { body: {} })).status).toBe(404);
  });

  it('serves card art to the deck only', async () => {
    const res = await fetch(`${base}/api/deck/card/OP01-001.jpg`, { headers: { authorization: `Bearer ${deckToken}` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('jpeg-bytes');
    expect((await fetch(`${base}/api/deck/card/OP99-999.jpg`, { headers: { authorization: `Bearer ${deckToken}` } })).status).toBe(404);
    expect((await fetch(`${base}/api/deck/card/..%2Fsecret.jpg`, { headers: { authorization: `Bearer ${deckToken}` } })).status).toBe(400);
    expect((await fetch(`${base}/api/deck/card/OP01-001.jpg`, { headers: { cookie } })).status).toBe(401);
  });

  it('keeps a card face on a button', async () => {
    const r = await call('PUT', '/api/deck', { body: { columns: 4, buttons: [{ ...applause, card: { img: 'OP01-001.jpg', name: 'Roronoa Zoro' } }] } });
    expect(r.status).toBe(200);
    expect(r.body.buttons[0].card).toEqual({ img: 'OP01-001.jpg', name: 'Roronoa Zoro' });
    expect((await call('PUT', '/api/deck', { body: { columns: 4, buttons: [{ ...applause, card: { img: '../x.jpg' } }] } })).status).toBe(400);
  });
});
