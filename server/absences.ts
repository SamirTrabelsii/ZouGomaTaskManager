import { Router, type Request, type RequestHandler } from 'express';
import type pg from 'pg';
import { agentUserOf, findSecret } from './agent';
import {
  ABSENCE_STEPS, absenceMails, awayWindows, cleanDays, describeDays, EMPTY_SETTINGS, mailHtml, planningCells,
  type AbsenceDay, type AbsenceSettings, type AbsenceStep, type Recipients,
} from './absenceText';

/**
 * Absences: the owner picks days in the room, LifeOS keeps the request and its steps (mails, planning, statuses, Boond),
 * and a local executor (n8n on the owner's PC) polls for the steps it knows, runs them and reports each result.
 * The executor authenticates with an agent token, exactly like the local agent.
 */

export const ABSENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS absence_settings (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS absences (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days         JSONB NOT NULL,
  label        TEXT NOT NULL,
  first_day    DATE NOT NULL,
  last_day     DATE NOT NULL,
  -- what the executor gets, frozen when the owner confirmed: the mails as previewed, the away windows, the planning cells
  payload      JSONB NOT NULL,
  cancelled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS absences_user_idx ON absences(user_id, first_day DESC);
CREATE TABLE IF NOT EXISTS absence_steps (
  id          BIGSERIAL PRIMARY KEY,
  absence_id  BIGINT NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  detail      TEXT NOT NULL DEFAULT '',
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (absence_id, kind)
);
CREATE INDEX IF NOT EXISTS absence_steps_status_idx ON absence_steps(status);
-- when an executor last asked for work, so the room can say whether anyone is listening
CREATE TABLE IF NOT EXISTS absence_executors (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kinds        TEXT NOT NULL DEFAULT ''
);
`;

/** A step that started and never reported within this long is marked failed rather than run again (a mail must not go twice). */
export const STALE_STEP_MINUTES = 30;
/** No poll for this long and the executor counts as offline. */
export const EXECUTOR_ONLINE_MS = 5 * 60_000;
export const ABSENCE_RETENTION_DAYS = 400;
const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

const idOf = (v: unknown) => { const s = String(v); return /^\d{1,18}$/.test(s) ? s : null; };

function cleanRecipients(v: unknown): Recipients | string {
  const r = (v ?? {}) as Partial<Recipients>;
  const list = (x: unknown) => (Array.isArray(x) ? x.map((e) => String(e).trim()).filter(Boolean) : null);
  const to = list(r.to), cc = list(r.cc ?? []);
  if (!to || !cc) return 'Recipients are lists of addresses.';
  if (to.length + cc.length > MAX_RECIPIENTS) return `At most ${MAX_RECIPIENTS} recipients per mail.`;
  const bad = [...to, ...cc].find((e) => e.length > 200 || !EMAIL.test(e));
  if (bad) return `"${bad.slice(0, 60)}" is not an email address.`;
  return { to, cc };
}

export function cleanSettings(v: unknown): AbsenceSettings | string {
  const b = (v ?? {}) as Record<string, unknown>;
  const employer = cleanRecipients(b.employer);
  if (typeof employer === 'string') return employer;
  const client = cleanRecipients(b.client);
  if (typeof client === 'string') return client;
  const planningName = typeof b.planningName === 'string' ? b.planningName.trim() : '';
  if (planningName.length > 100) return 'The planning name is too long.';
  return { employer, client, planningName };
}

async function loadSettings(pool: pg.Pool, userId: number): Promise<AbsenceSettings> {
  const { rows } = await pool.query('SELECT data FROM absence_settings WHERE user_id=$1', [userId]);
  return rows[0] ? { ...EMPTY_SETTINGS, ...(rows[0].data as AbsenceSettings) } : EMPTY_SETTINGS;
}

/** Why the chosen steps cannot run with these settings, or null. */
function missingSettings(steps: AbsenceStep[], s: AbsenceSettings): string | null {
  if (steps.includes('mail_employer') && !s.employer.to.length) return 'Add who receives the Olivesoft mail in the settings.';
  if (steps.includes('mail_client') && !s.client.to.length) return 'Add who receives the Skill and You mail in the settings.';
  if (steps.includes('planning') && !s.planningName) return 'Add your name as written in the team planning, in the settings.';
  return null;
}

/** Old absences go; steps started long ago without an answer are marked failed. Cheap, so it runs on each look. */
export async function tidyAbsences(pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE absence_steps SET status='failed', finished_at=now(), detail='Started but never reported back: check by hand before running it again.'
     WHERE status='running' AND started_at < now() - interval '${STALE_STEP_MINUTES} minutes'`);
  await pool.query(`DELETE FROM absences WHERE last_day < current_date - ${ABSENCE_RETENTION_DAYS}`);
}

export function absenceRouter(pool: pg.Pool, requireAuth: RequestHandler, userIdOf: (req: Request) => number, requireAgent: RequestHandler) {
  const router = Router();

  /* ── owner (signed-in session) ── */

  router.get('/settings', requireAuth, async (req, res, next) => {
    try { res.json(await loadSettings(pool, userIdOf(req))); } catch (e) { next(e); }
  });

  router.put('/settings', requireAuth, async (req, res, next) => {
    try {
      const s = cleanSettings(req.body);
      if (typeof s === 'string') return res.status(400).json({ error: s });
      await pool.query(
        `INSERT INTO absence_settings (user_id, data) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [userIdOf(req), JSON.stringify(s)]);
      res.json(s);
    } catch (e) { next(e); }
  });

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      await tidyAbsences(pool);
      const [abs, steps, exec] = await Promise.all([
        pool.query(
          `SELECT id, days, label, cancelled_at, created_at FROM absences WHERE user_id=$1
           ORDER BY first_day DESC, id DESC LIMIT 30`, [userId]),
        pool.query(
          `SELECT s.id, s.absence_id, s.kind, s.status, s.detail, s.finished_at FROM absence_steps s
           JOIN absences a ON a.id=s.absence_id WHERE a.user_id=$1`, [userId]),
        pool.query('SELECT last_seen_at, kinds FROM absence_executors WHERE user_id=$1', [userId]),
      ]);
      const order = (k: string) => ABSENCE_STEPS.indexOf(k as AbsenceStep);
      const e = exec.rows[0];
      res.json({
        absences: abs.rows.map((a) => ({
          id: String(a.id), days: a.days, label: a.label, cancelled: !!a.cancelled_at, createdAt: a.created_at,
          steps: steps.rows.filter((s) => String(s.absence_id) === String(a.id)).sort((x, y) => order(x.kind) - order(y.kind))
            .map((s) => ({ id: String(s.id), kind: s.kind, status: s.status, detail: s.detail, finishedAt: s.finished_at })),
        })),
        executor: {
          lastSeenAt: e ? e.last_seen_at : null,
          online: !!e && Date.now() - new Date(e.last_seen_at).getTime() < EXECUTOR_ONLINE_MS,
          kinds: e && e.kinds ? String(e.kinds).split(',') : [],
        },
      });
    } catch (e) { next(e); }
  });

  /** The owner confirms an absence: its days and the steps to run. */
  router.post('/', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const days = cleanDays(b.days);
      if (typeof days === 'string') return res.status(400).json({ error: days });
      const chosen = Array.isArray(b.steps) ? [...new Set(b.steps)] : [];
      if (!chosen.length || chosen.some((k) => !ABSENCE_STEPS.includes(k as AbsenceStep))) {
        return res.status(400).json({ error: 'Pick at least one action from the list.' });
      }
      const steps = ABSENCE_STEPS.filter((k) => chosen.includes(k));
      const settings = await loadSettings(pool, userId);
      const missing = missingSettings(steps, settings);
      if (missing) return res.status(400).json({ error: missing });

      // the same day cannot be in two live absences
      const { rows: clash } = await pool.query(
        `SELECT a.label FROM absences a, jsonb_array_elements(a.days) d
         WHERE a.user_id=$1 AND a.cancelled_at IS NULL AND d->>'date' = ANY($2::text[]) LIMIT 1`,
        [userId, days.map((d) => d.date)]);
      if (clash[0]) return res.status(409).json({ error: `One of these days is already booked (${clash[0].label}).` });

      const mails = absenceMails(days, settings).map((m) => ({ ...m, html: mailHtml(m), text: m.lines.join('\n') }));
      const payload = { mails, windows: awayWindows(days), planning: { name: settings.planningName, cells: planningCells(days) } };
      const label = describeDays(days);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO absences (user_id, days, label, first_day, last_day, payload) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [userId, JSON.stringify(days), label, days[0].date, days[days.length - 1].date, JSON.stringify(payload)]);
        for (const kind of steps) await client.query('INSERT INTO absence_steps (absence_id, kind) VALUES ($1,$2)', [rows[0].id, kind]);
        await client.query('COMMIT');
        res.status(201).json({ id: String(rows[0].id), label });
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    } catch (e) { next(e); }
  });

  /** Take an absence back while nothing has started yet. */
  router.post('/:id/cancel', requireAuth, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const { rows } = id ? await pool.query(
        `SELECT a.id, bool_and(s.status='pending') AS untouched FROM absences a LEFT JOIN absence_steps s ON s.absence_id=a.id
         WHERE a.id=$1 AND a.user_id=$2 AND a.cancelled_at IS NULL GROUP BY a.id`, [id, userIdOf(req)]) : { rows: [] };
      if (!rows[0]) return res.status(404).json({ error: 'Absence not found, or already cancelled.' });
      if (rows[0].untouched === false) return res.status(409).json({ error: 'Some actions already ran: undo them by hand, then delete the absence.' });
      await pool.query('UPDATE absences SET cancelled_at=now() WHERE id=$1', [id]);
      await pool.query("UPDATE absence_steps SET status='skipped', detail='Absence cancelled', finished_at=now() WHERE absence_id=$1", [id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /** Remove an absence from the list once nothing is waiting or running. */
  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const r = id ? await pool.query(
        `DELETE FROM absences a WHERE a.id=$1 AND a.user_id=$2
         AND NOT EXISTS (SELECT 1 FROM absence_steps s WHERE s.absence_id=a.id AND s.status IN ('pending','running'))`, [id, userIdOf(req)]) : null;
      if (!r?.rowCount) return res.status(409).json({ error: 'Absence not found, or some actions are still waiting.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /** Run a failed or skipped step again. */
  router.post('/steps/:id/retry', requireAuth, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const r = id ? await pool.query(
        `UPDATE absence_steps s SET status='pending', detail='', started_at=NULL, finished_at=NULL FROM absences a
         WHERE s.id=$1 AND a.id=s.absence_id AND a.user_id=$2 AND a.cancelled_at IS NULL AND s.status IN ('failed','skipped')`,
        [id, userIdOf(req)]) : null;
      if (!r?.rowCount) return res.status(409).json({ error: 'Only a failed or skipped action can run again.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ── executor (agent token) ── */

  /** Steps waiting for the kinds this executor knows (?kinds=mail_employer,mail_client). Reading changes nothing but "last seen". */
  router.get('/work', requireAgent, async (req, res, next) => {
    try {
      const userId = agentUserOf(req);
      const kinds = String(req.query.kinds ?? '').split(',').map((k) => k.trim()).filter((k) => ABSENCE_STEPS.includes(k as AbsenceStep));
      if (!kinds.length) return res.status(400).json({ error: `kinds is a comma-separated list among: ${ABSENCE_STEPS.join(', ')}.` });
      await tidyAbsences(pool);
      await pool.query(
        `INSERT INTO absence_executors (user_id, kinds) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now(), kinds=EXCLUDED.kinds
         WHERE absence_executors.last_seen_at < now() - interval '1 minute' OR absence_executors.kinds <> EXCLUDED.kinds`,
        [userId, kinds.join(',')]);
      const { rows } = await pool.query(
        `SELECT s.id, s.kind, a.id AS absence_id, a.days, a.label, a.payload FROM absence_steps s JOIN absences a ON a.id=s.absence_id
         WHERE a.user_id=$1 AND a.cancelled_at IS NULL AND s.status='pending' AND s.kind = ANY($2::text[])
         ORDER BY a.first_day, s.id LIMIT 20`, [userId, kinds]);
      res.json({
        steps: rows.map((r) => {
          const p = r.payload as { mails: { key: string }[]; windows: unknown; planning: unknown };
          const mailKey = r.kind === 'mail_employer' ? 'employer' : r.kind === 'mail_client' ? 'client' : null;
          return {
            id: String(r.id), kind: r.kind,
            absence: { id: String(r.absence_id), days: r.days as AbsenceDay[], label: r.label, windows: p.windows, planning: p.planning },
            ...(mailKey ? { mail: p.mails.find((m) => m.key === mailKey) } : {}),
          };
        }),
      });
    } catch (e) { next(e); }
  });

  /** Claims a step before running it, so two executors (or two polls) never run it twice. */
  router.post('/steps/:id/start', requireAgent, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const r = id ? await pool.query(
        `UPDATE absence_steps s SET status='running', started_at=now() FROM absences a
         WHERE s.id=$1 AND a.id=s.absence_id AND a.user_id=$2 AND a.cancelled_at IS NULL AND s.status='pending'`, [id, agentUserOf(req)]) : null;
      if (!r?.rowCount) return res.status(409).json({ error: 'Step not found, or not waiting any more.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.post('/steps/:id/result', requireAgent, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const status = ['done', 'failed', 'skipped'].includes(b.status as string) ? (b.status as string) : null;
      const detail = b.detail === undefined ? '' : typeof b.detail === 'string' && b.detail.length <= 500 ? b.detail.trim() : null;
      if (!status || detail === null) return res.status(400).json({ error: 'status must be done, failed or skipped; detail is up to 500 characters.' });
      const secret = findSecret(detail);
      if (secret) return res.status(422).json({ error: `This looks like it contains a ${secret}. Remove it and send again.` });
      const r = id ? await pool.query(
        `UPDATE absence_steps s SET status=$3, detail=$4, finished_at=now() FROM absences a
         WHERE s.id=$1 AND a.id=s.absence_id AND a.user_id=$2 AND s.status IN ('pending','running')`,
        [id, agentUserOf(req), status, detail]) : null;
      if (!r?.rowCount) return res.status(409).json({ error: 'Step not found, or already finished.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}
