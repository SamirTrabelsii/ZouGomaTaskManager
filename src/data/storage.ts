import { DATA_VERSION, type AppData, type Prefs } from '../domain/types';
import { TEMPLATES } from '../domain/templates';
import { CERT_LEVELS, DEFAULT_CERT_LEVEL, safeUrl } from '../domain/certs';

/* ───────── Defaults & normalisation (also used to validate imports) ───────── */

export function defaultPrefs(): Prefs {
  return {
    notifications: { enabled: false },
    templates: Object.fromEntries(
      TEMPLATES.map((t) => [t.id, { enabled: t.id === 'personal' || t.id === 'habits', version: t.version }]),
    ),
    scene: { layoutVersion: 2, theme: 'evening', weather: 'clear', quality: 'auto', reduceMotion: false, sound: true, showcase: null, mode: 'auto', camera: null },
  };
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    tasks: [], scopes: [], projects: [], milestones: [], goals: [], certifications: [], habits: [], habitLogs: [],
    events: [], reminders: [], notes: [], ledger: [], cards: { sealed: [], owned: {} }, prefs: defaultPrefs(),
  };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && typeof (x as any).id === 'string') : []);

const TASK_SIZES = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
const TASK_STATUSES = new Set(['todo', 'doing', 'blocked', 'onhold', 'done']);
const GOAL_TIERS = new Set(['S', 'M', 'L', 'XL']);

/** Older data has no `scopeId`; a task pointing at a scope that no longer exists simply becomes unscoped. */
function normalizeTasks(tasks: any[], scopes: any[]): any[] {
  const ids = new Set(scopes.map((s) => s.id));
  return tasks.map(({ parentId: _legacy, ...t }) => ({
    ...t,
    status: TASK_STATUSES.has(t.status) ? t.status : 'todo',
    // HUGE was the old top size; it now maps to XXL, the new largest
    size: t.size === 'HUGE' ? 'XXL' : TASK_SIZES.has(t.size) ? t.size : null,
    blockedBy: t.status === 'blocked' && typeof t.blockedBy === 'string' ? t.blockedBy : '',
    resumeOn: t.status === 'onhold' && typeof t.resumeOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.resumeOn) ? t.resumeOn : null,
    scopeId: typeof t.scopeId === 'string' && ids.has(t.scopeId) ? t.scopeId : null,
  }));
}

const CERT_STATUSES = new Set(['planned', 'studying', 'earned']);
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Data older than v4 has no certifications. */
function normalizeCerts(certs: any[]): any[] {
  return certs.filter((c) => typeof c.title === 'string').map((c) => ({
    ...c,
    issuer: text(c.issuer),
    level: Object.hasOwn(CERT_LEVELS, c.level) ? c.level : DEFAULT_CERT_LEVEL,
    status: CERT_STATUSES.has(c.status) ? c.status : 'planned',
    examDate: day(c.examDate),
    earnedOn: day(c.earnedOn),
    expiresOn: day(c.expiresOn),
    credentialId: text(c.credentialId),
    credentialUrl: safeUrl(text(c.credentialUrl)),
    notes: text(c.notes),
    remindBefore: Number.isInteger(c.remindBefore) && c.remindBefore > 0 ? c.remindBefore : null,
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : new Date(0).toISOString(),
  }));
}

/** Keeps well-formed entries, and only the first entry per source key (a reward is never paid twice). */
function normalizeLedger(entries: any[]): any[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (typeof e.key !== 'string' || typeof e.amount !== 'number' || !Number.isFinite(e.amount) || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

function normalizeCards(raw: any): AppData['cards'] {
  const sealed = arr(raw?.sealed).filter((p) =>
    typeof p.setId === 'string' && Array.isArray(p.cards) && p.cards.length > 0 && p.cards.every((c: unknown) => typeof c === 'string'))
    .map(({ boxId, ...p }) => (typeof boxId === 'string' ? { ...p, boxId } : p));
  const owned: Record<string, number> = {};
  if (raw?.owned && typeof raw.owned === 'object' && !Array.isArray(raw.owned)) {
    for (const [id, n] of Object.entries(raw.owned)) if (Number.isInteger(n) && (n as number) > 0) owned[id] = n as number;
  }
  return { sealed, owned };
}

/** Validates + migrates arbitrary JSON into AppData. Throws on anything that is clearly not LifeOS data. */
export function normalize(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Not a LifeOS data file.');
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'number') throw new Error('Missing data version.');
  if (r.version > DATA_VERSION) throw new Error(`This data was made by a newer LifeOS (v${r.version}).`);
  const base = emptyData();
  const prefs = (r.prefs ?? {}) as Partial<Prefs>;
  const scopes = arr(r.scopes).filter((s) => typeof s.title === 'string').map((s) => ({
    ...s, icon: typeof s.icon === 'string' ? s.icon : '📁', color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#62b4ff',
  }));
  const d: AppData = {
    ...base,
    scopes,
    tasks: normalizeTasks(arr(r.tasks).filter((t) => typeof t.title === 'string'), scopes),
    projects: arr(r.projects).filter((t) => typeof t.title === 'string'),
    milestones: arr(r.milestones),
    goals: arr(r.goals).map((g) => ({
      ...g,
      reward: GOAL_TIERS.has(g.reward) ? g.reward : null,
      rewardSetAt: GOAL_TIERS.has(g.reward) && typeof g.rewardSetAt === 'string' ? g.rewardSetAt : null,
    })),
    certifications: normalizeCerts(arr(r.certifications)),
    habits: arr(r.habits),
    habitLogs: arr(r.habitLogs),
    events: arr(r.events),
    reminders: arr(r.reminders),
    notes: arr(r.notes),
    ledger: normalizeLedger(arr(r.ledger)),
    cards: normalizeCards(r.cards),
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
