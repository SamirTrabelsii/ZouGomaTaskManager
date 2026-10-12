import { create } from 'zustand';
import {
  type AppData, type CalEvent, type Goal, type Habit, type Milestone, type Note, type Project,
  type Reminder, type SceneObjectId, type Task, type ViewId, type Prefs,
} from '../domain/types';
import { showSystemNotification } from './notify';
import { dateTimeOf, localDateTime, toLocalInput, todayStr } from '../domain/dates';
import { TEMPLATES, templateById } from '../domain/templates';
import { emptyData, exportJson, LocalStorageAdapter, normalize, type BackupInfo } from '../data/storage';
import { Syncer, initialCloud, type CloudState, type StartResult } from '../data/sync';
import { cloud as cloudApi, ApiError, type CloudBackup } from '../data/cloud';

export const storage = new LocalStorageAdapter();

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
}

interface UIState {
  status: 'loading' | 'ready' | 'corrupt' | 'signin';
  /** Account + sync state. `enabled` is false in local-only mode (no server). */
  cloud: CloudState;
  loadError: string | null;
  corruptRaw: string | null;
  saveError: string | null;
  view: ViewId;
  selected: SceneObjectId | null;
  hovered: SceneObjectId | null;
  /** UI-only camera close-up on a decoration (not a panel). */
  lookAt: 'poster' | null;
  settingsOpen: boolean;
  inboxOpen: boolean;
  toasts: Toast[];
  pulse: Partial<Record<SceneObjectId, { key: number; celebrate: boolean }>>;
  cameraResetKey: number;
  /** Deep-link into panels: e.g. open a given project or note. */
  focus: { type: 'project' | 'goal' | 'habit' | 'note' | 'event'; id: string } | null;
}

interface Actions {
  load(): Promise<void>;
  /** Returns an error message to show, or null on success. */
  signIn(email: string, password: string, mode: 'login' | 'register'): Promise<string | null>;
  signOut(): Promise<void>;
  resolveConflict(keep: 'server' | 'mine'): Promise<void>;
  listCloudBackups(): Promise<CloudBackup[]>;
  restoreCloudBackup(id: string): Promise<void>;
  // navigation
  setView(v: ViewId): void;
  select(o: SceneObjectId | null): void;
  hover(o: SceneObjectId | null): void;
  setFocus(f: UIState['focus']): void;
  toggleSettings(open?: boolean): void;
  toggleInbox(open?: boolean): void;
  resetCamera(): void;
  setLookAt(v: 'poster' | null): void;
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
  // tasks
  addTask(input: Partial<Task> & { title: string }): Task;
  updateTask(id: string, patch: Partial<Task>): void;
  toggleTask(id: string): void;
  deleteTask(id: string): void;
  setTaskReminder(taskId: string, at: string | null): void;
  // projects
  addProject(input: Partial<Project> & { title: string }): Project;
  updateProject(id: string, patch: Partial<Project>): void;
  deleteProject(id: string): void;
  addMilestone(projectId: string, title: string, dueDate?: string | null): void;
  updateMilestone(id: string, patch: Partial<Milestone>): void;
  toggleMilestone(id: string): void;
  deleteMilestone(id: string): void;
  // goals
  addGoal(input: Partial<Goal> & { title: string }): Goal;
  updateGoal(id: string, patch: Partial<Goal>): void;
  deleteGoal(id: string): void;
  // habits
  addHabit(input: Partial<Habit> & { title: string }): Habit;
  updateHabit(id: string, patch: Partial<Habit>): void;
  deleteHabit(id: string): void;
  toggleHabitLog(habitId: string, date: string): void;
  addTemplateStarters(templateId: string): number;
  // events & reminders
  addEvent(input: Partial<CalEvent> & { title: string; date: string }): void;
  updateEvent(id: string, patch: Partial<CalEvent>): void;
  deleteEvent(id: string): void;
  addReminder(title: string, at: string): void;
  deleteReminder(id: string): void;
  ackReminder(id: string): void;
  snoozeReminder(id: string, minutes: number): void;
  deliverDueReminders(now?: Date): void;
  // notes
  addNote(input: Partial<Note>): Note;
  updateNote(id: string, patch: Partial<Note>): void;
  deleteNote(id: string): void;
  // prefs & data safety
  updatePrefs(fn: (p: Prefs) => Prefs): void;
  setTemplateEnabled(id: string, enabled: boolean): void;
  exportData(): string;
  importData(json: string): boolean;
  listBackups(): BackupInfo[];
  restoreBackup(id: string): void;
  resetAll(): void;
  startFreshAfterCorrupt(): void;
  restoreFromCorruptBackup(id: string): void;
}

type Store = UIState & Actions & { data: AppData };

let toastSeq = 1;
let pulseSeq = 1;
const nowIso = () => new Date().toISOString();
export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const useStore = create<Store>((set, get) => {
  const commit = (fn: (d: AppData) => AppData) => set((s) => ({ data: fn(s.data) }));
  const pulse = (o: SceneObjectId, celebrate = false) =>
    set((s) => ({ pulse: { ...s.pulse, [o]: { key: pulseSeq++, celebrate } } }));
  const toast: Actions['toast'] = (text, kind = 'ok', action) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 7000 : 3800);
  };
  /** Run a destructive change and offer a short window to take it back. */
  const withUndo = (label: string, fn: () => void) => {
    const snapshot = get().data;
    fn();
    toast(label, 'info', { label: 'Undo', run: () => set({ data: snapshot }) });
  };
  const upsertReminder = (d: AppData, link: NonNullable<Reminder['link']>, title: string, at: string | null): AppData => {
    const existing = d.reminders.find((r) => r.link?.type === link.type && r.link.id === link.id);
    if (!at) return { ...d, reminders: d.reminders.filter((r) => r !== existing) };
    if (existing) {
      const changed = existing.at !== at;
      return {
        ...d,
        reminders: d.reminders.map((r) =>
          r === existing ? { ...r, title, at, ...(changed ? { deliveredAt: null, deliveredVia: null, ackedAt: null } : {}) } : r),
      };
    }
    const rem: Reminder = { id: uid(), title, at, link, deliveredAt: null, deliveredVia: null, ackedAt: null };
    return { ...d, reminders: [...d.reminders, rem] };
  };
  const eventReminderAt = (e: CalEvent): string | null => {
    if (e.remindBefore == null) return null;
    const base = dateTimeOf(e.date, e.time ?? '09:00');
    return toLocalInput(new Date(base.getTime() - e.remindBefore * 60000));
  };

  return {
    data: emptyData(),
    status: 'loading',
    cloud: initialCloud(),
    loadError: null,
    corruptRaw: null,
    saveError: null,
    view: 'home',
    selected: null,
    hovered: null,
    lookAt: null,
    settingsOpen: false,
    inboxOpen: false,
    toasts: [],
    pulse: {},
    cameraResetKey: 0,
    focus: null,

    async load() {
      const apply = (r: StartResult) => {
        if (r.kind === 'ready') { lastSaved = r.data; set({ data: r.data, status: 'ready' }); }
        else if (r.kind === 'signin') set({ status: 'signin' });
        else if (r.kind === 'corrupt') set({ status: 'corrupt', loadError: r.error, corruptRaw: r.raw });
      };
      try {
        const r: StartResult = await syncer.start();
        if (r.kind !== 'local') return apply(r);
        const res = await storage.load();
        if (res.status === 'ok') { lastSaved = res.data; set({ data: res.data, status: 'ready' }); }
        else set({ status: 'corrupt', loadError: res.error, corruptRaw: res.raw });
      } catch (e) {
        set({ status: 'corrupt', loadError: (e as Error).message, corruptRaw: '' });
      }
    },

    async signIn(email, password, mode) {
      try {
        const r: StartResult = await syncer.signIn(email, password, mode);
        if (r.kind === 'ready') { lastSaved = r.data; set({ data: r.data, status: 'ready' }); }
        else if (r.kind === 'corrupt') set({ status: 'corrupt', loadError: r.error, corruptRaw: r.raw });
        return null;
      } catch (e) {
        if (e instanceof ApiError) return e.message;
        return 'Cannot reach the LifeOS server. Check that it is running.';
      }
    },
    async signOut() {
      await syncer.signOut();
      set({ status: 'signin', data: emptyData(), selected: null, settingsOpen: false, inboxOpen: false });
    },
    async resolveConflict(keep) {
      const data = await syncer.resolveConflict(keep);
      if (data) { set({ data }); toast('Using the cloud version. Your other copy was kept as a backup.', 'info'); }
      else if (!get().cloud.conflict) toast('Your version replaced the cloud copy. The old one is in cloud backups.', 'info');
    },
    async listCloudBackups() {
      try { return (await cloudApi.listBackups()).backups; } catch { return []; }
    },
    async restoreCloudBackup(id) {
      try {
        const b = await cloudApi.getBackup(id);
        const next = normalize(b.data);
        storage.makeBackup('before cloud restore');
        set({ data: next });
        toast('Cloud backup restored.');
      } catch (e) {
        toast(`Restore failed: ${(e as Error).message}`, 'error');
      }
    },

    setView: (view) => set({ view, selected: view === 'home' ? get().selected : null, lookAt: view === 'home' ? get().lookAt : null }),
    select: (selected) => set({ selected, view: selected ? 'home' : get().view, focus: null, lookAt: selected ? null : get().lookAt }),
    setLookAt: (lookAt) => set(lookAt ? { lookAt, selected: null, view: 'home', hovered: null } : { lookAt: null }),
    hover: (hovered) => set({ hovered }),
    setFocus: (focus) => set({ focus }),
    toggleSettings: (open) => set((s) => ({ settingsOpen: open ?? !s.settingsOpen })),
    toggleInbox: (open) => set((s) => ({ inboxOpen: open ?? !s.inboxOpen })),
    resetCamera: () => {
      commit((d) => ({ ...d, prefs: { ...d.prefs, scene: { ...d.prefs.scene, camera: null } } }));
      set((s) => ({ cameraResetKey: s.cameraResetKey + 1, lookAt: null }));
    },
    toast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    /* ── tasks ── */
    addTask(input) {
      const t: Task = {
        id: uid(), notes: '', status: 'todo', priority: 'medium', dueDate: null,
        projectId: null, milestoneId: null, goalId: null, createdAt: nowIso(), completedAt: null,
        ...input, title: input.title.trim(),
      };
      if (t.status === 'done' && !t.completedAt) t.completedAt = nowIso();
      commit((d) => ({ ...d, tasks: [t, ...d.tasks] }));
      pulse('desk');
      return t;
    },
    updateTask(id, patch) {
      const before = get().data.tasks.find((t) => t.id === id);
      if (!before) return;
      const next: Task = { ...before, ...patch };
      if (patch.status && patch.status !== before.status) {
        next.completedAt = patch.status === 'done' ? nowIso() : null;
      }
      if (patch.projectId !== undefined && patch.projectId !== before.projectId && !('milestoneId' in patch)) next.milestoneId = null;
      commit((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? next : t)) }));
      if (next.status === 'done' && before.status !== 'done') {
        pulse('desk');
        if (next.projectId) pulse('bookshelf');
      }
      // keep a task reminder consistent with the title
      commit((d) => ({ ...d, reminders: d.reminders.map((r) => (r.link?.type === 'task' && r.link.id === id ? { ...r, title: next.title } : r)) }));
    },
    toggleTask(id) {
      const t = get().data.tasks.find((x) => x.id === id);
      if (t) get().updateTask(id, { status: t.status === 'done' ? 'todo' : 'done' });
    },
    deleteTask(id) {
      const t = get().data.tasks.find((x) => x.id === id);
      withUndo(`Deleted “${t?.title ?? 'task'}”`, () =>
        commit((d) => ({
          ...d,
          tasks: d.tasks.filter((x) => x.id !== id),
          reminders: d.reminders.filter((r) => !(r.link?.type === 'task' && r.link.id === id)),
        })));
    },
    setTaskReminder(taskId, at) {
      const t = get().data.tasks.find((x) => x.id === taskId);
      if (!t) return;
      commit((d) => upsertReminder(d, { type: 'task', id: taskId }, t.title, at));
    },

    /* ── projects ── */
    addProject(input) {
      const p: Project = { id: uid(), description: '', status: 'active', deadline: null, createdAt: nowIso(), ...input, title: input.title.trim() };
      commit((d) => ({ ...d, projects: [p, ...d.projects] }));
      pulse('bookshelf');
      return p;
    },
    updateProject(id, patch) {
      const before = get().data.projects.find((p) => p.id === id);
      commit((d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      if (patch.status === 'done' && before?.status !== 'done') {
        pulse('bookshelf', true);
        toast('Project complete — nicely done.');
      } else pulse('bookshelf');
    },
    deleteProject(id) {
      const p = get().data.projects.find((x) => x.id === id);
      withUndo(`Deleted project “${p?.title ?? ''}”`, () =>
        commit((d) => ({
          ...d,
          projects: d.projects.filter((x) => x.id !== id),
          milestones: d.milestones.filter((m) => m.projectId !== id),
          tasks: d.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null, milestoneId: null } : t)),
        })));
    },
    addMilestone(projectId, title, dueDate = null) {
      const m: Milestone = { id: uid(), projectId, title: title.trim(), dueDate, done: false, completedAt: null };
      commit((d) => ({ ...d, milestones: [...d.milestones, m] }));
      pulse('bookshelf');
    },
    updateMilestone(id, patch) {
      commit((d) => ({ ...d, milestones: d.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    },
    toggleMilestone(id) {
      const m = get().data.milestones.find((x) => x.id === id);
      if (!m) return;
      const done = !m.done;
      commit((d) => ({ ...d, milestones: d.milestones.map((x) => (x.id === id ? { ...x, done, completedAt: done ? nowIso() : null } : x)) }));
      pulse('bookshelf', done);
      if (done) toast(`Milestone reached: ${m.title}`);
    },
    deleteMilestone(id) {
      withUndo('Milestone deleted', () =>
        commit((d) => ({
          ...d,
          milestones: d.milestones.filter((m) => m.id !== id),
          tasks: d.tasks.map((t) => (t.milestoneId === id ? { ...t, milestoneId: null } : t)),
        })));
    },

    /* ── goals ── */
    addGoal(input) {
      const g: Goal = { id: uid(), description: '', unit: '', target: 100, current: 0, deadline: null, createdAt: nowIso(), ...input, title: input.title.trim() };
      commit((d) => ({ ...d, goals: [g, ...d.goals] }));
      pulse('bookshelf');
      return g;
    },
    updateGoal(id, patch) {
      const before = get().data.goals.find((g) => g.id === id);
      commit((d) => ({ ...d, goals: d.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
      const after = { ...before!, ...patch };
      const reached = before && before.current < before.target && after.current >= after.target && after.target > 0;
      pulse('bookshelf', !!reached);
      if (reached) toast(`Goal reached: ${after.title}`);
    },
    deleteGoal(id) {
      const g = get().data.goals.find((x) => x.id === id);
      withUndo(`Deleted goal “${g?.title ?? ''}”`, () =>
        commit((d) => ({
          ...d,
          goals: d.goals.filter((x) => x.id !== id),
          tasks: d.tasks.map((t) => (t.goalId === id ? { ...t, goalId: null } : t)),
        })));
    },

    /* ── habits ── */
    addHabit(input) {
      const h: Habit = { id: uid(), frequency: 'daily', target: 1, archived: false, createdAt: nowIso(), origin: null, ...input, title: input.title.trim() };
      if (h.frequency === 'daily') h.target = 1;
      commit((d) => ({ ...d, habits: [...d.habits, h] }));
      pulse('plants');
      return h;
    },
    updateHabit(id, patch) {
      commit((d) => ({ ...d, habits: d.habits.map((h) => (h.id === id ? { ...h, ...patch, target: (patch.frequency ?? h.frequency) === 'daily' ? 1 : patch.target ?? h.target } : h)) }));
    },
    deleteHabit(id) {
      const h = get().data.habits.find((x) => x.id === id);
      withUndo(`Deleted habit “${h?.title ?? ''}”`, () =>
        commit((d) => ({ ...d, habits: d.habits.filter((x) => x.id !== id), habitLogs: d.habitLogs.filter((l) => l.habitId !== id) })));
    },
    toggleHabitLog(habitId, date) {
      const has = get().data.habitLogs.some((l) => l.habitId === habitId && l.date === date);
      commit((d) => ({
        ...d,
        habitLogs: has
          ? d.habitLogs.filter((l) => !(l.habitId === habitId && l.date === date))
          : [...d.habitLogs, { id: uid(), habitId, date }],
      }));
      if (!has) pulse('plants');
    },
    addTemplateStarters(templateId) {
      const tpl = templateById(templateId);
      if (!tpl) return 0;
      let added = 0;
      for (const s of tpl.starterHabits) {
        const origin = `${tpl.id}:${s.key}`;
        if (get().data.habits.some((h) => h.origin === origin || h.title.toLowerCase() === s.title.toLowerCase())) continue;
        get().addHabit({ title: s.title, frequency: s.frequency, target: s.target, origin });
        added++;
      }
      return added;
    },

    /* ── events & reminders ── */
    addEvent(input) {
      const e: CalEvent = { id: uid(), kind: 'event', time: null, endTime: null, notes: '', remindBefore: null, ...input, title: input.title.trim() };
      commit((d) => upsertReminder({ ...d, events: [...d.events, e] }, { type: 'event', id: e.id }, e.title, eventReminderAt(e)));
      pulse('calendar');
    },
    updateEvent(id, patch) {
      const cur = get().data.events.find((e) => e.id === id);
      if (!cur) return;
      const e = { ...cur, ...patch };
      commit((d) => upsertReminder({ ...d, events: d.events.map((x) => (x.id === id ? e : x)) }, { type: 'event', id }, e.title, eventReminderAt(e)));
      pulse('calendar');
    },
    deleteEvent(id) {
      const e = get().data.events.find((x) => x.id === id);
      withUndo(`Deleted “${e?.title ?? 'event'}”`, () =>
        commit((d) => ({
          ...d,
          events: d.events.filter((x) => x.id !== id),
          reminders: d.reminders.filter((r) => !(r.link?.type === 'event' && r.link.id === id)),
        })));
    },
    addReminder(title, at) {
      const r: Reminder = { id: uid(), title: title.trim(), at, link: null, deliveredAt: null, deliveredVia: null, ackedAt: null };
      commit((d) => ({ ...d, reminders: [...d.reminders, r] }));
      pulse('calendar');
    },
    deleteReminder(id) {
      commit((d) => ({ ...d, reminders: d.reminders.filter((r) => r.id !== id) }));
    },
    ackReminder(id) {
      commit((d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === id ? { ...r, ackedAt: nowIso() } : r)) }));
    },
    snoozeReminder(id, minutes) {
      const at = toLocalInput(new Date(Date.now() + minutes * 60000));
      commit((d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === id ? { ...r, at, deliveredAt: null, deliveredVia: null, ackedAt: null } : r)) }));
      toast(`Snoozed for ${minutes} minutes`, 'info');
    },
    deliverDueReminders(now = new Date()) {
      const { data } = get();
      const due = data.reminders.filter((r) => !r.deliveredAt && localDateTime(r.at) <= now);
      if (!due.length) return;
      const canNotify =
        data.prefs.notifications.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted';
      const delivered = new Map<string, 'browser' | 'in-app'>();
      for (const r of due) {
        const lateMs = now.getTime() - localDateTime(r.at).getTime();
        let via: 'browser' | 'in-app' = 'in-app';
        // Don't pop an OS notification for something that was due many hours ago (e.g. tab was closed).
        if (canNotify && lateMs < 6 * 3600_000) {
          try {
            void showSystemNotification('LifeOS reminder', r.title, `lifeos-${r.id}`);
            via = 'browser';
          } catch { /* fall back to in-app */ }
        }
        delivered.set(r.id, via);
      }
      // Mark as delivered *before* anything else so a re-render or second tick can't resend.
      commit((d) => ({
        ...d,
        reminders: d.reminders.map((r) =>
          delivered.has(r.id) ? { ...r, deliveredAt: nowIso(), deliveredVia: delivered.get(r.id)! } : r),
      }));
      due.forEach((r) => toast(`Reminder: ${r.title}`, 'info'));
    },

    /* ── notes ── */
    addNote(input) {
      const n: Note = {
        id: uid(), title: '', body: '', kind: 'note', tags: [], pinned: false, createdAt: nowIso(), updatedAt: nowIso(), ...input,
      };
      commit((d) => ({ ...d, notes: [n, ...d.notes] }));
      pulse('notebook');
      return n;
    },
    updateNote(id, patch) {
      commit((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: nowIso() } : n)) }));
    },
    deleteNote(id) {
      const n = get().data.notes.find((x) => x.id === id);
      withUndo(`Deleted note “${n?.title || 'Untitled'}”`, () =>
        commit((d) => ({ ...d, notes: d.notes.filter((x) => x.id !== id) })));
    },

    /* ── prefs & data safety ── */
    updatePrefs(fn) {
      commit((d) => ({ ...d, prefs: fn(d.prefs) }));
    },
    setTemplateEnabled(id, enabled) {
      const tpl = templateById(id);
      if (!tpl) return;
      const enabledCount = TEMPLATES.filter((t) => get().data.prefs.templates[t.id]?.enabled).length;
      if (!enabled && enabledCount <= 1) {
        toast('Keep at least one template enabled.', 'error');
        return;
      }
      commit((d) => ({
        ...d,
        prefs: { ...d.prefs, templates: { ...d.prefs.templates, [id]: { enabled, version: tpl.version } } },
      }));
      if (!enabled) toast(`${tpl.name} turned off. Your data is untouched.`, 'info');
    },
    exportData: () => exportJson(get().data),
    importData(json) {
      try {
        const next = normalize(JSON.parse(json));
        storage.makeBackup('before import');
        set({ data: next });
        toast(`Imported ${next.tasks.length} tasks, ${next.notes.length} notes and more.`);
        return true;
      } catch (e) {
        toast(`Import failed: ${(e as Error).message}`, 'error');
        return false;
      }
    },
    listBackups: () => storage.listBackups(),
    restoreBackup(id) {
      try {
        const next = storage.readBackup(id);
        storage.makeBackup('before restore');
        set({ data: next });
        toast('Backup restored.');
      } catch (e) {
        toast(`Restore failed: ${(e as Error).message}`, 'error');
      }
    },
    resetAll() {
      storage.makeBackup('before reset');
      set({ data: emptyData(), selected: null });
      toast('All data cleared. A backup was kept.', 'info');
    },
    startFreshAfterCorrupt() {
      storage.quarantineCorrupt(get().corruptRaw ?? '');
      set({ data: emptyData(), status: 'ready', loadError: null, corruptRaw: null });
    },
    restoreFromCorruptBackup(id) {
      try {
        const next = storage.readBackup(id);
        storage.quarantineCorrupt(get().corruptRaw ?? '');
        set({ data: next, status: 'ready', loadError: null, corruptRaw: null });
        toast('Backup restored.');
      } catch (e) {
        toast(`Restore failed: ${(e as Error).message}`, 'error');
      }
    },
  };
});

const syncer: Syncer = new Syncer({
  local: storage,
  getData: (): AppData => useStore.getState().data,
  setData: (data) => useStore.setState({ data }),
  getCloud: (): CloudState => useStore.getState().cloud,
  setCloud: (patch) => useStore.setState((s) => ({ cloud: { ...s.cloud, ...patch } })),
  toast: (text, kind) => useStore.getState().toast(text, kind),
});

/* ───────── Persistence: debounce-save whenever data changes ───────── */
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSaved: AppData | null = null;
useStore.subscribe((s) => {
  if (s.status !== 'ready' || s.data === lastSaved) return;
  const data = s.data;
  clearTimeout(timer);
  timer = setTimeout(() => {
    storage.save(data).then(
      () => { lastSaved = data; syncer.queue(data); if (useStore.getState().saveError) useStore.setState({ saveError: null }); },
      (e) => useStore.setState({ saveError: (e as Error).message || 'Could not save to this browser.' }),
    );
  }, 250);
});
// Flush pending save when leaving the page.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useStore.getState();
    if (s.status === 'ready' && s.data !== lastSaved) void storage.save(s.data);
  });
}

export const today = todayStr;
