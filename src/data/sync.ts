import type { AppData } from '../domain/types';
import { cloud, ApiError, NetworkError } from './cloud';
import { emptyData, normalize, type Storage } from './storage';

/**
 * Cloud sync on top of the local cache.
 *
 * - The browser always saves locally first (instant, works offline). The server copy follows.
 * - Each device remembers the server revision it last saw and whether it has unsynced edits.
 * - If the server moved on while this device also has unsynced edits, nothing is overwritten silently:
 *   the user picks which copy to keep, and the other one is backed up first.
 */

export type SyncStatus = 'idle' | 'saving' | 'offline' | 'conflict' | 'signedout';

export interface CloudState {
  enabled: boolean;
  email: string | null;
  status: SyncStatus;
  hasUser: boolean;
  registrationOpen: boolean;
  conflict: { data: AppData; revision: number } | null;
  lastSyncedAt: string | null;
}

export const initialCloud = (): CloudState => ({
  enabled: false, email: null, status: 'idle', hasUser: false, registrationOpen: true, conflict: null, lastSyncedAt: null,
});

export type StartResult =
  | { kind: 'local' }                                  // no server: purely local mode
  | { kind: 'signin' }                                 // server present, need credentials
  | { kind: 'ready'; data: AppData }
  | { kind: 'corrupt'; error: string; raw: string };

interface Meta { revision: number; dirty: boolean }
const META_KEY = 'lifeos.v1.sync';
const readMeta = (): Meta | null => {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) ?? 'null'); return m && typeof m.revision === 'number' ? { revision: m.revision, dirty: !!m.dirty } : null; }
  catch { return null; }
};
const writeMeta = (m: Meta | null) => {
  try { if (m) localStorage.setItem(META_KEY, JSON.stringify(m)); else localStorage.removeItem(META_KEY); } catch { /* storage full/blocked */ }
};

export interface SyncContext {
  local: Storage;
  getData(): AppData;
  setData(d: AppData): void;
  getCloud(): CloudState;
  setCloud(patch: Partial<CloudState>): void;
  toast(text: string, kind?: 'ok' | 'error' | 'info'): void;
}

export class Syncer {
  private meta: Meta = readMeta() ?? { revision: 0, dirty: false };
  private latest: AppData | null = null;
  private inflight = false;
  private again = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor(private ctx: SyncContext) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.flush(); });
    }
  }

  /** Decide the mode and load the right copy of the data. */
  async start(): Promise<StartResult> {
    const health = await cloud.health();
    const wasCloud = readMeta() !== null;
    if (!health && !wasCloud) return { kind: 'local' };
    this.ctx.setCloud({ enabled: true, hasUser: health?.hasUser ?? true, registrationOpen: health?.registrationOpen ?? false });
    if (!health) {
      // Previously synced device, server unreachable: keep working from the local cache and retry.
      const res = await this.ctx.local.load();
      if (res.status !== 'ok') return { kind: 'corrupt', error: res.error, raw: res.raw };
      this.ctx.setCloud({ status: 'offline' });
      this.scheduleRetry();
      return { kind: 'ready', data: res.data };
    }
    try {
      const me = await cloud.me();
      this.ctx.setCloud({ email: me.email, status: 'idle' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.ctx.setCloud({ status: 'signedout' }); return { kind: 'signin' }; }
      throw e;
    }
    return this.loadSignedIn();
  }

  async signIn(email: string, password: string, mode: 'login' | 'register'): Promise<StartResult> {
    const r = mode === 'register' ? await cloud.register(email, password) : await cloud.login(email, password);
    this.ctx.setCloud({ email: r.email, status: 'idle' });
    return this.loadSignedIn();
  }

  async signOut(): Promise<void> {
    await this.flush();
    try { await cloud.logout(); } catch { /* cookie may already be gone */ }
    // Don't leave a private copy behind on a shared device.
    this.ctx.local.makeBackup('before sign-out');
    writeMeta(null);
    this.meta = { revision: 0, dirty: false };
    this.ctx.setCloud({ email: null, status: 'signedout', conflict: null });
  }

  private async loadSignedIn(): Promise<StartResult> {
    const local = await this.ctx.local.load();
    const localOk = local.status === 'ok' ? local : null;
    const hasLocalWork = !!localOk && !localOk.fresh;
    let server: { data: unknown | null; revision: number };
    try { server = await cloud.getData(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.ctx.setCloud({ status: 'signedout' }); return { kind: 'signin' }; }
      if (e instanceof NetworkError && localOk) { this.ctx.setCloud({ status: 'offline' }); this.scheduleRetry(); return { kind: 'ready', data: localOk.data }; }
      throw e;
    }

    const stored = readMeta();

    // 1. Nothing on the server yet: first sign-in. Move this browser's data into the account.
    if (server.data === null) {
      const data = localOk && hasLocalWork ? localOk.data : emptyData();
      this.meta = { revision: 0, dirty: true };
      writeMeta(this.meta);
      this.latest = data;
      await this.push();
      if (hasLocalWork) this.ctx.toast('Your data from this browser is now saved to your account.', 'ok');
      return { kind: 'ready', data };
    }

    let serverData: AppData;
    try { serverData = normalize(server.data); }
    catch (e) { return { kind: 'corrupt', error: `The saved cloud data could not be read: ${(e as Error).message}`, raw: JSON.stringify(server.data) }; }

    // 2. This device has edits the server hasn't seen.
    const unsynced = stored ? stored.dirty : hasLocalWork; // never-synced local data counts as unsynced work
    if (unsynced && localOk) {
      if (stored && stored.revision === server.revision) {
        // server unchanged since we last synced: our edits simply go up
        this.meta = { revision: server.revision, dirty: true };
        writeMeta(this.meta);
        this.latest = localOk.data;
        void this.push();
        return { kind: 'ready', data: localOk.data };
      }
      // both sides changed: ask
      this.meta = { revision: server.revision, dirty: true };
      writeMeta(this.meta);
      this.ctx.setCloud({ status: 'conflict', conflict: { data: serverData, revision: server.revision } });
      return { kind: 'ready', data: localOk.data };
    }

    // 3. Plain case: take the server copy.
    this.meta = { revision: server.revision, dirty: false };
    writeMeta(this.meta);
    await this.ctx.local.save(serverData);
    this.ctx.setCloud({ lastSyncedAt: new Date().toISOString(), status: 'idle' });
    return { kind: 'ready', data: serverData };
  }

  /** Called after every local save. */
  queue(data: AppData) {
    if (!this.ctx.getCloud().enabled) return;
    this.latest = data;
    this.meta = { ...this.meta, dirty: true };
    writeMeta(this.meta);
    const st = this.ctx.getCloud().status;
    if (st === 'conflict' || st === 'signedout') return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.push(), 1200);
  }

  /** Push any pending edits right now (used on reconnect, tab focus and sign-out). */
  async flush() {
    const st = this.ctx.getCloud();
    if (!st.enabled || st.status === 'conflict' || st.status === 'signedout') return;
    if (!this.meta.dirty) return;
    this.latest = this.latest ?? this.ctx.getData();
    clearTimeout(this.debounce);
    await this.push();
  }

  private scheduleRetry() {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.flushOrReconnect(), 15_000);
  }

  private async flushOrReconnect() {
    if (this.ctx.getCloud().status !== 'offline') return;
    this.latest = this.latest ?? this.ctx.getData();
    if (!this.meta.dirty) {
      // nothing to send; just see whether the server is back
      if (await cloud.health()) this.ctx.setCloud({ status: 'idle' }); else this.scheduleRetry();
      return;
    }
    await this.push();
  }

  private async push(): Promise<void> {
    if (this.inflight) { this.again = true; return; }
    this.inflight = true;
    try {
      do {
        this.again = false;
        const sent = this.latest;
        if (!sent) break;
        this.ctx.setCloud({ status: 'saving' });
        const res = await cloud.putData(sent, this.meta.revision);
        const stillDirty = this.latest !== sent;
        this.meta = { revision: res.revision, dirty: stillDirty };
        writeMeta(this.meta);
        this.ctx.setCloud({ status: 'idle', lastSyncedAt: new Date().toISOString() });
        if (stillDirty) this.again = true;
      } while (this.again);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const b = e.body as { data: unknown | null; revision: number };
        try {
          this.ctx.setCloud({ status: 'conflict', conflict: { data: b.data ? normalize(b.data) : emptyData(), revision: b.revision } });
        } catch { this.ctx.setCloud({ status: 'offline' }); this.scheduleRetry(); }
      } else if (e instanceof ApiError && e.status === 401) {
        this.ctx.setCloud({ status: 'signedout' });
      } else {
        // network trouble or a server hiccup: keep the edits (they are in the local cache) and try again
        this.ctx.setCloud({ status: 'offline' });
        this.scheduleRetry();
      }
    } finally { this.inflight = false; }
  }

  /** The user's decision after a conflict. The copy that loses is always backed up first. */
  async resolveConflict(keep: 'server' | 'mine'): Promise<AppData | null> {
    const c = this.ctx.getCloud().conflict;
    if (!c) return null;
    this.ctx.local.makeBackup(keep === 'server' ? 'before using cloud version' : 'automatic');
    if (keep === 'server') {
      this.meta = { revision: c.revision, dirty: false };
      writeMeta(this.meta);
      this.latest = null;
      await this.ctx.local.save(c.data);
      this.ctx.setCloud({ conflict: null, status: 'idle', lastSyncedAt: new Date().toISOString() });
      return c.data;
    }
    const mine = this.ctx.getData();
    try {
      const res = await cloud.putData(mine, c.revision, true); // the server stores its own copy as a backup before overwriting
      this.meta = { revision: res.revision, dirty: false };
      writeMeta(this.meta);
      this.latest = mine;
      this.ctx.setCloud({ conflict: null, status: 'idle', lastSyncedAt: new Date().toISOString() });
    } catch {
      this.ctx.toast('Could not reach the server. Try again in a moment.', 'error');
    }
    return null;
  }
}
