import { DATA_VERSION, type AppData, type Prefs } from '../domain/types';
import { TEMPLATES } from '../domain/templates';

/* ───────── Defaults & normalisation (also used to validate imports) ───────── */

export function defaultPrefs(): Prefs {
  return {
    notifications: { enabled: false },
    templates: Object.fromEntries(
      TEMPLATES.map((t) => [t.id, { enabled: t.id === 'personal' || t.id === 'habits', version: t.version }]),
    ),
    scene: { layoutVersion: 2, theme: 'evening', weather: 'clear', quality: 'auto', reduceMotion: false, mode: 'auto', camera: null },
  };
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    tasks: [], projects: [], milestones: [], goals: [], habits: [], habitLogs: [],
    events: [], reminders: [], notes: [], prefs: defaultPrefs(),
  };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && typeof (x as any).id === 'string') : []);

/** Validates + migrates arbitrary JSON into AppData. Throws on anything that is clearly not LifeOS data. */
export function normalize(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Not a LifeOS data file.');
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'number') throw new Error('Missing data version.');
  if (r.version > DATA_VERSION) throw new Error(`This data was made by a newer LifeOS (v${r.version}).`);
  const base = emptyData();
  const prefs = (r.prefs ?? {}) as Partial<Prefs>;
  const d: AppData = {
    ...base,
    tasks: arr(r.tasks).filter((t) => typeof t.title === 'string'),
    projects: arr(r.projects).filter((t) => typeof t.title === 'string'),
    milestones: arr(r.milestones),
    goals: arr(r.goals),
    habits: arr(r.habits),
    habitLogs: arr(r.habitLogs),
    events: arr(r.events),
    reminders: arr(r.reminders),
    notes: arr(r.notes),
    prefs: {
      notifications: { ...base.prefs.notifications, ...prefs.notifications },
      templates: { ...base.prefs.templates, ...prefs.templates },
      scene: { ...base.prefs.scene, ...prefs.scene },
    },
  };
  // Scene layout v2: isometric night-study restyle. Reset the saved camera and lighting once.
  if ((prefs.scene?.layoutVersion ?? 1) < 2) {
    d.prefs.scene = { ...d.prefs.scene, layoutVersion: 2, theme: 'evening', camera: null };
  }
  d.version = DATA_VERSION;
  return d;
}

/* ───────── Storage contract (swap the implementation for an API later) ───────── */

export interface BackupInfo { id: string; savedAt: string; reason: string }

export type LoadResult =
  | { status: 'ok'; data: AppData; fresh: boolean }
  | { status: 'corrupt'; error: string; raw: string };

export interface Storage {
  load(): Promise<LoadResult>;
  save(data: AppData): Promise<void>;
  listBackups(): BackupInfo[];
  readBackup(id: string): AppData;
  makeBackup(reason: string): void;
  /** Keeps the unreadable payload aside, then clears it. */
  quarantineCorrupt(raw: string): void;
}

const KEY = 'lifeos.v1.data';
const BACKUP_PREFIX = 'lifeos.v1.backup.';
const MAX_BACKUPS = 6;
const AUTO_BACKUP_EVERY_MS = 10 * 60 * 1000;

export class LocalStorageAdapter implements Storage {
  private lastAuto = 0;

  async load(): Promise<LoadResult> {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { status: 'ok', data: emptyData(), fresh: true };
    try {
      return { status: 'ok', data: normalize(JSON.parse(raw)), fresh: false };
    } catch (e) {
      return { status: 'corrupt', error: (e as Error).message, raw };
    }
  }

  async save(data: AppData): Promise<void> {
    const prev = localStorage.getItem(KEY);
    if (prev && Date.now() - this.lastAuto > AUTO_BACKUP_EVERY_MS) {
      this.pushBackup(prev, 'automatic');
      this.lastAuto = Date.now();
    }
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  makeBackup(reason: string) {
    const cur = localStorage.getItem(KEY);
    if (cur) this.pushBackup(cur, reason);
  }

  private pushBackup(payload: string, reason: string) {
    const id = Date.now().toString(36);
    localStorage.setItem(BACKUP_PREFIX + id, JSON.stringify({ savedAt: new Date().toISOString(), reason, payload }));
    const all = this.backupKeys();
    all.slice(0, Math.max(0, all.length - MAX_BACKUPS)).forEach((k) => localStorage.removeItem(k));
  }

  private backupKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(BACKUP_PREFIX)) keys.push(k);
    }
    return keys.sort();
  }

  listBackups(): BackupInfo[] {
    return this.backupKeys()
      .map((k) => {
        try {
          const b = JSON.parse(localStorage.getItem(k) ?? '');
          return { id: k.slice(BACKUP_PREFIX.length), savedAt: b.savedAt as string, reason: b.reason as string };
        } catch { return null; }
      })
      .filter((b): b is BackupInfo => !!b)
      .reverse();
  }

  readBackup(id: string): AppData {
    const b = JSON.parse(localStorage.getItem(BACKUP_PREFIX + id) ?? 'null');
    if (!b) throw new Error('Backup not found.');
    return normalize(JSON.parse(b.payload));
  }

  quarantineCorrupt(raw: string) {
    localStorage.setItem('lifeos.v1.corrupt.' + Date.now().toString(36), raw);
    localStorage.removeItem(KEY);
  }
}

export function exportJson(data: AppData): string {
  return JSON.stringify({ app: 'LifeOS', exportedAt: new Date().toISOString(), ...data }, null, 2);
}
