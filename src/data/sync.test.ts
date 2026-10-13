import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../domain/types';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
});

// A tiny in-memory stand-in for the server so the sync rules can be tested without a network.
const server = { data: null as unknown, revision: 0, authed: true, online: true, health: true };
class Net extends Error {}
class Api extends Error { constructor(public status: number, m: string, public body: unknown = null) { super(m); } }
vi.mock('./cloud', () => ({
  ApiError: Api,
  NetworkError: Net,
  cloud: {
    health: async () => (server.health ? { ok: true, hasUser: true, registrationOpen: false } : null),
    me: async () => { if (!server.authed) throw new Api(401, 'no'); return { email: 'me@example.com' }; },
    login: async () => ({ email: 'me@example.com' }),
    register: async () => ({ email: 'me@example.com', recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE' }),
    resetPassword: async () => ({ email: 'me@example.com', recoveryCode: 'FFFF-GGGG-HHHH-JJJJ-KKKK' }),
    logout: async () => ({ ok: true }),
    getData: async () => { if (!server.online) throw new Net('offline'); return { data: server.data, revision: server.revision }; },
    putData: async (data: unknown, base: number, force = false) => {
      if (!server.online) throw new Net('offline');
      if (!force && base !== server.revision) throw new Api(409, 'conflict', { data: server.data, revision: server.revision });
      server.data = data; server.revision += 1;
      return { revision: server.revision };
    },
  },
}));

const { Syncer, initialCloud } = await import('./sync');
const { emptyData, LocalStorageAdapter } = await import('./storage');

const withTasks = (n: number): AppData => ({ ...emptyData(), tasks: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `T${i}` })) as AppData['tasks'] });

function make() {
  const local = new LocalStorageAdapter();
  let data = emptyData();
  let cloud = initialCloud();
  const toasts: string[] = [];
  const syncer = new Syncer({
    local,
    getData: () => data,
    setData: (d) => { data = d; },
    getCloud: () => cloud,
    setCloud: (p) => { cloud = { ...cloud, ...p }; },
    toast: (t) => { toasts.push(t); },
  });
  return { local, syncer, toasts, get cloud() { return cloud; }, setLocal: async (d: AppData) => { data = d; await local.save(d); } };
}

beforeEach(() => {
  mem.clear();
  Object.assign(server, { data: null, revision: 0, authed: true, online: true, health: true });
});

describe('cloud sync', () => {
  it('runs in local-only mode when there is no server and this device was never synced', async () => {
    server.health = false;
    expect((await make().syncer.start()).kind).toBe('local');
  });

  it('asks for sign-in when the server says the session is gone', async () => {
    server.authed = false;
    const t = make();
    expect((await t.syncer.start()).kind).toBe('signin');
    expect(t.cloud.status).toBe('signedout');
  });

  it('moves existing browser data into a brand-new account', async () => {
    const t = make();
    await t.local.save(withTasks(3));
    const r = await t.syncer.start();
    expect(r.kind).toBe('ready');
    expect((server.data as AppData).tasks).toHaveLength(3);
    expect(server.revision).toBe(1);
    expect(t.toasts.some((x) => x.includes('now saved to your account'))).toBe(true);
  });

  it('takes the cloud copy on a fresh device with nothing local', async () => {
    server.data = withTasks(4); server.revision = 7;
    const t = make();
    const r = await t.syncer.start();
    expect(r.kind === 'ready' && r.data.tasks).toHaveLength(4);
    expect(JSON.parse(mem.get('lifeos.v1.sync')!)).toEqual({ revision: 7, dirty: false });
  });

  it('pushes local edits when the server has not changed since the last sync', async () => {
    server.data = withTasks(1); server.revision = 2;
    mem.set('lifeos.v1.sync', JSON.stringify({ revision: 2, dirty: true }));
    const t = make();
    await t.local.save(withTasks(5));
    await t.syncer.start();
    await vi.waitFor(() => expect(server.revision).toBe(3));
    expect((server.data as AppData).tasks).toHaveLength(5);
  });

  it('flags a conflict, without overwriting either side, when both changed', async () => {
    server.data = withTasks(9); server.revision = 5;
    mem.set('lifeos.v1.sync', JSON.stringify({ revision: 2, dirty: true }));
    const t = make();
    await t.local.save(withTasks(2));
    const r = await t.syncer.start();
    expect(r.kind === 'ready' && r.data.tasks).toHaveLength(2);
    expect(t.cloud.status).toBe('conflict');
    expect(t.cloud.conflict?.data.tasks).toHaveLength(9);
    expect(server.revision).toBe(5); // untouched
  });

  it('does not ask which version to keep when both sides hold identical data, whatever the key order', async () => {
    const mine = withTasks(3);
    expect(Object.keys(mine)).not.toEqual(Object.keys(mine).reverse());
    // JSONB hands keys back in a different order
    server.data = JSON.parse(JSON.stringify(mine, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse()) : x))); server.revision = 7;
    const t = make();
    await t.local.save(mine); // e.g. left behind by a sign-out, which clears the sync marker
    await t.syncer.start();
    expect(t.cloud.status).toBe('idle');
    expect(t.cloud.conflict).toBeNull();
    expect(server.revision).toBe(7);
  });

  it('treats never-synced local data plus existing cloud data as a conflict (second device)', async () => {
    server.data = withTasks(9); server.revision = 5;
    const t = make();
    await t.local.save(withTasks(2));
    await t.syncer.start();
    expect(t.cloud.status).toBe('conflict');
  });

  it('resolving "use cloud" keeps a local backup and adopts the server copy', async () => {
    server.data = withTasks(9); server.revision = 5;
    const t = make();
    await t.local.save(withTasks(2));
    await t.syncer.start();
    const adopted = await t.syncer.resolveConflict('server');
    expect(adopted?.tasks).toHaveLength(9);
    expect(t.local.listBackups().length).toBeGreaterThan(0);
    expect(t.cloud.status).toBe('idle');
    expect(JSON.parse(mem.get('lifeos.v1.sync')!)).toEqual({ revision: 5, dirty: false });
  });

  it('resolving "keep mine" overwrites the cloud with this device\'s data', async () => {
    server.data = withTasks(9); server.revision = 5;
    const t = make();
    await t.setLocal(withTasks(2));
    await t.syncer.start();
    await t.syncer.resolveConflict('mine');
    expect((server.data as AppData).tasks).toHaveLength(2);
    expect(server.revision).toBe(6);
    expect(t.cloud.status).toBe('idle');
  });

  it('keeps edits when the server is unreachable and sends them once it is back', async () => {
    server.data = withTasks(1); server.revision = 1;
    const t = make();
    await t.syncer.start();
    server.online = false;
    const edited = withTasks(6);
    await t.setLocal(edited);
    t.syncer.queue(edited);
    await t.syncer.flush();
    expect(t.cloud.status).toBe('offline');
    expect(JSON.parse(mem.get('lifeos.v1.sync')!).dirty).toBe(true);
    server.online = true;
    await t.syncer.flush();
    expect(t.cloud.status).toBe('idle');
    expect((server.data as AppData).tasks).toHaveLength(6);
    expect(JSON.parse(mem.get('lifeos.v1.sync')!).dirty).toBe(false);
  });

  it('hands back the recovery code issued at account creation, but not on a plain sign-in', async () => {
    const created = await make().syncer.signIn('me@example.com', 'long enough password', 'register');
    expect(created.recoveryCode).toBe('AAAA-BBBB-CCCC-DDDD-EEEE');
    expect(created.start.kind).toBe('ready');
    expect((await make().syncer.signIn('me@example.com', 'long enough password', 'login')).recoveryCode).toBeUndefined();
  });

  it('a password reset signs in, loads the account data and yields the replacement recovery code', async () => {
    server.data = withTasks(2); server.revision = 4;
    const t = make();
    const r = await t.syncer.resetPassword('me@example.com', 'AAAA-BBBB-CCCC-DDDD-EEEE', 'a new passphrase');
    expect(r.recoveryCode).toBe('FFFF-GGGG-HHHH-JJJJ-KKKK');
    expect(r.start.kind === 'ready' && r.start.data.tasks).toHaveLength(2);
    expect(t.cloud.email).toBe('me@example.com');
  });

  it('keeps working from the local cache when a previously synced device cannot reach the server', async () => {
    mem.set('lifeos.v1.sync', JSON.stringify({ revision: 3, dirty: false }));
    server.health = false;
    const t = make();
    await t.local.save(withTasks(2));
    const r = await t.syncer.start();
    expect(r.kind === 'ready' && r.data.tasks).toHaveLength(2);
    expect(t.cloud.status).toBe('offline');
  });
});
