import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import type pg from 'pg';
import { listTokens, makeRequireAgent, tokenRoutes, agentUserOf, type Limiter } from './agent';
import { mutateDocument } from './documents';

/**
 * The browser extension's door into LifeOS: the task list, adding (also from a page), editing, ticking off, deleting.
 * It signs in with a bearer token of scope 'tasks', which opens these task routes and nothing else (no notes or journal,
 * no alerts, no absences, no full data). The owner creates and revokes those tokens with the normal signed-in session.
 *
 * Tasks live inside the user's single LifeOS document, so every write here locks it, edits the task list and bumps the
 * revision: an open app tab sees the newer revision when it regains focus and reloads it.
 */

export const STATUSES = ['todo', 'doing', 'blocked', 'onhold', 'done'] as const;
type Status = (typeof STATUSES)[number];
const PRIORITIES = ['low', 'medium', 'high'] as const;
/** Done tasks stay in the list this long, so a mistaken tick can be undone from the popup. */
const RECENT_DONE_MS = 48 * 3600_000;
const MAX_LISTED = 300;
export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;
const MAX_BLOCKED_BY = 200;

interface StoredTask {
  id: string; title: string; notes: string; status: string; priority: string; size: string | null; dueDate: string | null;
  projectId: string | null; milestoneId: string | null; goalId: string | null; scopeId: string | null;
  blockedBy: string; resumeOn: string | null; createdAt: string; completedAt: string | null;
}
interface StoredScope { id: string; title: string; icon: string; color: string }
interface StoredProject { id: string; title: string }
interface StoredReminder { title: string; link?: { type: string; id: string } | null }

const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const tasksOf = (data: Record<string, unknown>): StoredTask[] => (Array.isArray(data.tasks) ? (data.tasks as StoredTask[]) : []);
const scopesOf = (data: Record<string, unknown>): StoredScope[] => (Array.isArray(data.scopes) ? (data.scopes as StoredScope[]) : []);
const remindersOf = (data: Record<string, unknown>): StoredReminder[] => (Array.isArray(data.reminders) ? (data.reminders as StoredReminder[]) : []);
const isTaskReminder = (r: StoredReminder, id: string) => r.link?.type === 'task' && r.link.id === id;

/** The first web link in the notes (a task captured from a page keeps the page's address there). */
export function linkOf(notes: string | undefined): string | null {
  const m = /https?:\/\/[^\s<>"']+/.exec(notes ?? '');
  return m ? m[0] : null;
}

/** Only what the popup shows: the notes themselves stay in the app, their first link comes along. */
const view = (t: StoredTask) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, scopeId: t.scopeId, projectId: t.projectId,
  completedAt: t.completedAt, blockedBy: t.blockedBy ?? '', resumeOn: t.resumeOn ?? null, link: linkOf(t.notes),
});

type Edit = Partial<Pick<StoredTask, 'title' | 'status' | 'priority' | 'dueDate' | 'scopeId' | 'blockedBy' | 'resumeOn'>>;
/** Checks a PATCH body. Returns the edit, or an error message. */
function parseEdit(b: Record<string, unknown>): Edit | string {
  const e: Edit = {};
  if ('title' in b) {
    const title = typeof b.title === 'string' ? b.title.trim().replace(/\s+/g, ' ') : '';
    if (!title || title.length > MAX_TITLE) return `Give the task a title of up to ${MAX_TITLE} characters.`;
    e.title = title;
  }
  if ('status' in b) {
    if (!STATUSES.includes(b.status as Status)) return `Status must be one of ${STATUSES.join(', ')}.`;
    e.status = b.status as Status;
  }
  if ('priority' in b) {
    if (!PRIORITIES.includes(b.priority as never)) return 'Unknown priority.';
    e.priority = b.priority as string;
  }
  if ('dueDate' in b) {
    if (b.dueDate !== null && !isDate(b.dueDate)) return 'Due date must be YYYY-MM-DD.';
    e.dueDate = b.dueDate as string | null;
  }
  if ('scopeId' in b) {
    if (b.scopeId !== null && typeof b.scopeId !== 'string') return 'Unknown scope.';
    e.scopeId = b.scopeId as string | null;
  }
  if ('blockedBy' in b) {
    if (typeof b.blockedBy !== 'string' || b.blockedBy.length > MAX_BLOCKED_BY) return `Say what it waits on in up to ${MAX_BLOCKED_BY} characters.`;
    e.blockedBy = b.blockedBy.trim();
  }
  if ('resumeOn' in b) {
    if (b.resumeOn !== null && !isDate(b.resumeOn)) return 'Resume date must be YYYY-MM-DD.';
    e.resumeOn = b.resumeOn as string | null;
  }
  if (!Object.keys(e).length) return 'Nothing to change.';
  return e;
}

export function extensionRouter(
  pool: pg.Pool,
  requireAuth: RequestHandler,
  userIdOf: (req: Request) => number,
  limits: { perToken: Limiter; failures: Limiter },
) {
  const router = Router();
  const requireTasks = makeRequireAgent(pool, limits, 'tasks');

  /* ── owner (signed-in session): the extension's tokens ── */
  router.get('/tokens', requireAuth, async (req, res, next) => {
    try { res.json({ tokens: await listTokens(pool, userIdOf(req), 'tasks') }); } catch (e) { next(e); }
  });
  tokenRoutes(router, pool, requireAuth, userIdOf, 'tasks');

  /* ── extension (bearer token of scope 'tasks') ── */

  router.get('/tasks', requireTasks, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT data, revision FROM documents WHERE user_id=$1', [agentUserOf(req)]);
      const data = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const since = Date.now() - RECENT_DONE_MS;
      const tasks = tasksOf(data)
        .filter((t) => t.status !== 'done' || (!!t.completedAt && new Date(t.completedAt).getTime() >= since))
        .slice(0, MAX_LISTED)
        .map(view);
      const scopes = scopesOf(data).map((s) => ({ id: s.id, title: s.title, icon: s.icon, color: s.color }));
      const projects = (Array.isArray(data.projects) ? (data.projects as StoredProject[]) : []).map((p) => ({ id: p.id, title: p.title }));
      res.json({ tasks, scopes, projects, revision: rows[0]?.revision ?? 0 });
    } catch (e) { next(e); }
  });

  router.post('/tasks', requireTasks, async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as { title?: unknown; priority?: unknown; dueDate?: unknown; scopeId?: unknown; notes?: unknown };
      const title = typeof b.title === 'string' ? b.title.trim().replace(/\s+/g, ' ') : '';
      if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: `Give the task a title of up to ${MAX_TITLE} characters.` });
      if (b.priority !== undefined && !PRIORITIES.includes(b.priority as never)) return res.status(400).json({ error: 'Unknown priority.' });
      if (b.dueDate !== undefined && b.dueDate !== null && !isDate(b.dueDate)) return res.status(400).json({ error: 'Due date must be YYYY-MM-DD.' });
      if (b.scopeId !== undefined && b.scopeId !== null && typeof b.scopeId !== 'string') return res.status(400).json({ error: 'Unknown scope.' });
      if (b.notes !== undefined && (typeof b.notes !== 'string' || b.notes.length > MAX_NOTES)) {
        return res.status(400).json({ error: `Notes are limited to ${MAX_NOTES} characters.` });
      }
      const out = await mutateDocument(pool, agentUserOf(req), (data) => {
        const scopeId = typeof b.scopeId === 'string' && scopesOf(data).some((s) => s.id === b.scopeId) ? b.scopeId : null;
        const task: StoredTask = {
          id: crypto.randomUUID(), title, notes: typeof b.notes === 'string' ? b.notes.trim() : '', status: 'todo',
          priority: (b.priority as string | undefined) ?? 'medium', size: null, dueDate: (b.dueDate as string | null | undefined) ?? null,
          projectId: null, milestoneId: null, goalId: null, scopeId, blockedBy: '', resumeOn: null, createdAt: new Date().toISOString(), completedAt: null,
        };
        data.tasks = [task, ...tasksOf(data)]; // newest first, like the app
        return task;
      });
      if (!out) return res.status(409).json({ error: 'Open LifeOS once to set up your data first.' });
      res.status(201).json({ task: view(out.result!), revision: out.revision });
    } catch (e) { next(e); }
  });

  router.patch('/tasks/:id', requireTasks, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const edit = parseEdit((req.body ?? {}) as Record<string, unknown>);
      if (typeof edit === 'string') return res.status(400).json({ error: edit });
      let current: StoredTask | null = null;
      const out = await mutateDocument(pool, agentUserOf(req), (data) => {
        const tasks = tasksOf(data);
        const i = tasks.findIndex((t) => t.id === id);
        if (i < 0) return undefined;
        const before = tasks[i];
        current = before;
        const next: StoredTask = { ...before, ...edit };
        // an unknown scope is ignored rather than stored
        if (edit.scopeId && !scopesOf(data).some((s) => s.id === edit.scopeId)) next.scopeId = before.scopeId;
        // the same rules as updateTask in the app: completedAt follows done; the blocked note and resume date live only in their status
        if (next.status !== before.status) next.completedAt = next.status === 'done' ? new Date().toISOString() : null;
        if (next.status !== 'blocked') next.blockedBy = '';
        if (next.status !== 'onhold') next.resumeOn = null;
        if (JSON.stringify(next) === JSON.stringify(before)) return undefined; // nothing to write
        data.tasks = tasks.map((t, j) => (j === i ? next : t));
        // keep a task reminder consistent with the title
        if (next.title !== before.title) data.reminders = remindersOf(data).map((r) => (isTaskReminder(r, id) ? { ...r, title: next.title } : r));
        return next;
      });
      const task = out?.result ?? current;
      if (!out || !task) return res.status(404).json({ error: 'Task not found' });
      res.json({ task: view(task), revision: out.revision });
    } catch (e) { next(e); }
  });

  /** Deletes the task and its reminder, like the app. The popup offers an undo before it sends this. */
  router.delete('/tasks/:id', requireTasks, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const out = await mutateDocument(pool, agentUserOf(req), (data) => {
        const tasks = tasksOf(data);
        if (!tasks.some((t) => t.id === id)) return undefined;
        data.tasks = tasks.filter((t) => t.id !== id);
        data.reminders = remindersOf(data).filter((r) => !isTaskReminder(r, id));
        return true;
      });
      if (!out?.result) return res.status(404).json({ error: 'Task not found' });
      res.json({ ok: true, revision: out.revision });
    } catch (e) { next(e); }
  });

  return router;
}
