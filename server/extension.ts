import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import type pg from 'pg';
import { listTokens, makeRequireAgent, tokenRoutes, agentUserOf, type Limiter } from './agent';
import { mutateDocument } from './documents';

/**
 * The browser extension's door into LifeOS: a quick look at the open tasks, ticking them off, adding one.
 * It signs in with a bearer token of scope 'tasks', which opens these task routes and nothing else (no alerts, no
 * absences, no full data). The owner creates and revokes those tokens with the normal signed-in session.
 *
 * Tasks live inside the user's single LifeOS document, so every write here locks it, edits the task list and bumps the
 * revision: an open app tab sees the newer revision when it regains focus and reloads it.
 */

/** Statuses the extension may set. Blocked / on hold need a note or a date, so they stay in the app. */
export const EXT_STATUSES = ['todo', 'doing', 'done'] as const;
type ExtStatus = (typeof EXT_STATUSES)[number];
const PRIORITIES = ['low', 'medium', 'high'] as const;
/** Done tasks stay in the list this long, so a mistaken tick can be undone from the popup. */
const RECENT_DONE_MS = 48 * 3600_000;
const MAX_LISTED = 300;
export const MAX_TITLE = 200;

interface StoredTask {
  id: string; title: string; notes: string; status: string; priority: string; size: string | null; dueDate: string | null;
  projectId: string | null; milestoneId: string | null; goalId: string | null; scopeId: string | null;
  blockedBy: string; resumeOn: string | null; createdAt: string; completedAt: string | null;
}
interface StoredScope { id: string; title: string; icon: string; color: string }
interface StoredProject { id: string; title: string }

const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const tasksOf = (data: Record<string, unknown>): StoredTask[] => (Array.isArray(data.tasks) ? (data.tasks as StoredTask[]) : []);

/** Only what the popup shows: no notes. */
const view = (t: StoredTask) => ({
  id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, scopeId: t.scopeId, projectId: t.projectId,
  completedAt: t.completedAt,
});

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
      const scopes = (Array.isArray(data.scopes) ? (data.scopes as StoredScope[]) : []).map((s) => ({ id: s.id, title: s.title, icon: s.icon, color: s.color }));
      const projects = (Array.isArray(data.projects) ? (data.projects as StoredProject[]) : []).map((p) => ({ id: p.id, title: p.title }));
      res.json({ tasks, scopes, projects, revision: rows[0]?.revision ?? 0 });
    } catch (e) { next(e); }
  });

  router.post('/tasks', requireTasks, async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as { title?: unknown; priority?: unknown; dueDate?: unknown; scopeId?: unknown };
      const title = typeof b.title === 'string' ? b.title.trim() : '';
      if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: `Give the task a title of up to ${MAX_TITLE} characters.` });
      if (b.priority !== undefined && !PRIORITIES.includes(b.priority as never)) return res.status(400).json({ error: 'Unknown priority.' });
      if (b.dueDate !== undefined && b.dueDate !== null && !isDate(b.dueDate)) return res.status(400).json({ error: 'Due date must be YYYY-MM-DD.' });
      if (b.scopeId !== undefined && b.scopeId !== null && typeof b.scopeId !== 'string') return res.status(400).json({ error: 'Unknown scope.' });
      const out = await mutateDocument(pool, agentUserOf(req), (data) => {
        const scopes = Array.isArray(data.scopes) ? (data.scopes as StoredScope[]) : [];
        const scopeId = typeof b.scopeId === 'string' && scopes.some((s) => s.id === b.scopeId) ? b.scopeId : null;
        const task: StoredTask = {
          id: crypto.randomUUID(), title, notes: '', status: 'todo', priority: (b.priority as string | undefined) ?? 'medium', size: null,
          dueDate: (b.dueDate as string | null | undefined) ?? null, projectId: null, milestoneId: null, goalId: null, scopeId,
          blockedBy: '', resumeOn: null, createdAt: new Date().toISOString(), completedAt: null,
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
      const status = (req.body as { status?: unknown } | undefined)?.status;
      if (!EXT_STATUSES.includes(status as ExtStatus)) return res.status(400).json({ error: `Status must be one of ${EXT_STATUSES.join(', ')}.` });
      let current: StoredTask | null = null;
      const out = await mutateDocument(pool, agentUserOf(req), (data) => {
        const tasks = tasksOf(data);
        const i = tasks.findIndex((t) => t.id === id);
        if (i < 0) return undefined;
        current = tasks[i];
        if (current.status === status) return undefined; // already there: nothing to write
        // the same rules as updateTask in the app: completedAt follows done, the blocked note / resume date go
        const next: StoredTask = {
          ...current, status: status as string, completedAt: status === 'done' ? new Date().toISOString() : null, blockedBy: '', resumeOn: null,
        };
        data.tasks = tasks.map((t, j) => (j === i ? next : t));
        return next;
      });
      const task = out?.result ?? current;
      if (!out || !task) return res.status(404).json({ error: 'Task not found' });
      res.json({ task: view(task), revision: out.revision });
    } catch (e) { next(e); }
  });

  return router;
}
