import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type pg from 'pg';

/**
 * The local AI agent's door into LifeOS. The agent runs on the owner's computer and only ever calls out: it authenticates
 * with a long random bearer token (never the account password or the session cookie), and that token opens nothing but
 * the routes in this file. The owner manages tokens and reads the agent's status with the normal signed-in session.
 */

export const AGENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_tokens (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_tokens_user_idx ON agent_tokens(user_id);
-- the agent's last heartbeat: lets the room show "agent online / offline"
CREATE TABLE IF NOT EXISTS agent_status (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version      TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT 'idle'
);
-- one row per Rollbar item; the agent upserts it by external_id as the situation changes
CREATE TABLE IF NOT EXISTS agent_alerts (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  severity      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  occurrences   INTEGER NOT NULL DEFAULT 1,
  summary       TEXT NOT NULL DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);
CREATE TABLE IF NOT EXISTS agent_findings (
  id         BIGSERIAL PRIMARY KEY,
  alert_id   BIGINT NOT NULL REFERENCES agent_alerts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'note',
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_findings_alert_idx ON agent_findings(alert_id);
-- a proposed fix as plain text to copy. Short-lived: deleted when it expires, and its text is wiped once applied or ignored
CREATE TABLE IF NOT EXISTS agent_patches (
  id           BIGSERIAL PRIMARY KEY,
  alert_id     BIGINT NOT NULL REFERENCES agent_alerts(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  body         TEXT NOT NULL,
  test_command TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'proposed',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_patches_alert_idx ON agent_patches(alert_id);
CREATE INDEX IF NOT EXISTS agent_patches_expiry_idx ON agent_patches(expires_at);
-- orders from the owner to the agent, from a closed list. The agent polls for 'pending' ones, acknowledges, then reports a result
CREATE TABLE IF NOT EXISTS agent_commands (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  alert_id    BIGINT REFERENCES agent_alerts(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  result      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at    TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_commands_user_idx ON agent_commands(user_id, status);
`;

/** What the owner can ask for. Never free text: the agent only ever acts on one of these. */
export const COMMAND_KINDS = ['investigate', 'ignore', 'reanalyze', 'pause', 'resume'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
/** These target one alert; pause and resume apply to the agent as a whole. */
const ALERT_COMMANDS: readonly CommandKind[] = ['investigate', 'ignore', 'reanalyze'];
export const COMMAND_RESULTS = ['done', 'failed'] as const;
/** An order nobody picked up within this long is stale (the agent was off), so it is dropped rather than run days later. */
export const COMMAND_TTL_HOURS = 24;
export const MAX_PENDING_COMMANDS = 20;

export const TOKEN_PREFIX = 'lifeos_agent_';
export const CATEGORIES = ['data_quality', 'pipeline_failure', 'performance', 'schema', 'other'] as const;
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const ALERT_STATUSES = ['open', 'investigating', 'proposed', 'resolved', 'ignored'] as const;
/**
 * What a finding is: a confirmed cause, the headline that nothing is really wrong (noise), an unconfirmed lead, a piece of
 * evidence or context (note), or something for the owner to do next (todo).
 */
export const FINDING_KINDS = ['cause', 'noise', 'lead', 'note', 'todo'] as const;
export const PATCH_RESOLUTIONS = ['applied', 'ignored'] as const;

export const MAX_PATCH_BYTES = 20 * 1024;
export const PATCH_TTL_DAYS = 7;
export const ALERT_RETENTION_DAYS = 90;
export const MAX_ALERTS = 1000;
export const MAX_FINDINGS_PER_ALERT = 20;
export const MAX_LIVE_PATCHES = 50;

const EXTERNAL_ID = /^[\w.:-]{1,100}$/;

/**
 * Last line of defence against a credential leaving the agent's computer: the agent scans first, and the server refuses
 * anything that still looks like a secret. It reports only the kind, never the matched text.
 */
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['service account key', /"private_key"\s*:/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['LifeOS agent token', new RegExp(`${TOKEN_PREFIX}[A-Za-z0-9_-]{20,}`)],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['connection string with a password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i],
  ['credential assignment', /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["']?[^\s"'{}]{8,}/i],
];
export function findSecret(text: string): string | null {
  for (const [kind, re] of SECRET_PATTERNS) if (re.test(text)) return kind;
  return null;
}

/** How the agent starts the note it leaves when an automatic investigation could not finish (the list tells those apart from real findings). */
export const FAILED_NOTE = 'The automatic investigation could not finish';

/** Deletes expired fixes and alerts that have been quiet for a long time. Cheap, so it also runs whenever the owner looks. */
export async function purgeAgentData(pool: pg.Pool): Promise<void> {
  await pool.query('DELETE FROM agent_patches WHERE expires_at < now()');
  await pool.query(`DELETE FROM agent_alerts WHERE last_seen_at < now() - interval '${ALERT_RETENTION_DAYS} days'`);
  await pool.query(
    `UPDATE agent_commands SET status='expired', finished_at=now()
     WHERE status IN ('pending','acked') AND created_at < now() - interval '${COMMAND_TTL_HOURS} hours'`);
  await pool.query("DELETE FROM agent_commands WHERE created_at < now() - interval '30 days'");
}

export const MAX_ACTIVE_TOKENS = 3;
/** No heartbeat for this long and the agent counts as offline. */
export const ONLINE_WINDOW_MS = 10 * 60_000;
export const AGENT_STATES = ['idle', 'working', 'paused'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** Same shape as the limiter in app.ts: `hit` records an attempt and says whether it is still within the limit. */
export interface Limiter { hit(key: string): boolean }

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** 256 random bits. High entropy is why a plain SHA-256 is enough to store (no need for bcrypt). */
export function newAgentToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

type AgentReq = Request & { agentUserId: number; agentTokenId: string };
/** The account an agent token belongs to (only after `makeRequireAgent` let the request through). */
export const agentUserOf = (req: Request) => (req as AgentReq).agentUserId;
/** Which token made the request, to tell two executors of one account apart. */
export const agentTokenOf = (req: Request) => (req as AgentReq).agentTokenId;

/**
 * Bearer-token auth for the agent and the other local executors (n8n). Ignores cookies on purpose, so a browser session can
 * never act as the agent. Pass the same `limits` everywhere so one token has one budget.
 */
export function makeRequireAgent(pool: pg.Pool, limits: { perToken: Limiter; failures: Limiter }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
      const hash = m && m[1].startsWith(TOKEN_PREFIX) && m[1].length < 200 ? sha(m[1]) : null;
      const { rows } = hash
        ? await pool.query('SELECT id, user_id FROM agent_tokens WHERE token_hash=$1 AND revoked_at IS NULL', [hash])
        : { rows: [] as { id: string; user_id: string }[] };
      if (!rows[0]) {
        if (!limits.failures.hit(req.ip ?? 'unknown')) return res.status(429).json({ error: 'Too many failed attempts.' });
        return res.status(401).json({ error: 'Invalid agent token' });
      }
      if (!limits.perToken.hit(hash!)) return res.status(429).json({ error: 'Slow down.' });
      // at most one write a minute per token, so a busy agent does not keep a sleeping database awake
      await pool.query(
        "UPDATE agent_tokens SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [rows[0].id]);
      (req as AgentReq).agentUserId = Number(rows[0].user_id);
      (req as AgentReq).agentTokenId = String(rows[0].id);
      next();
    } catch (e) { next(e); }
  };
}

export function agentRouter(
  pool: pg.Pool,
  requireAuth: RequestHandler,
  userIdOf: (req: Request) => number,
  limits: { perToken: Limiter; failures: Limiter },
) {
  const router = Router();
  const requireAgent = makeRequireAgent(pool, limits);

  /* ── owner (signed-in session) ── */

  /** Token list and the agent's status, in one call for the settings panel and the room. */
  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const [tokens, status] = await Promise.all([
        pool.query('SELECT id, name, hint, created_at, last_used_at FROM agent_tokens WHERE user_id=$1 AND revoked_at IS NULL ORDER BY id', [userId]),
        pool.query('SELECT last_seen_at, version, state FROM agent_status WHERE user_id=$1', [userId]),
      ]);
      const s = status.rows[0];
      const lastSeenAt: Date | null = s ? s.last_seen_at : null;
      res.json({
        online: !!lastSeenAt && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS,
        lastSeenAt, version: s?.version ?? '', state: s?.state ?? 'idle',
        tokens: tokens.rows.map((t) => ({ id: String(t.id), name: t.name, hint: t.hint, createdAt: t.created_at, lastUsedAt: t.last_used_at })),
      });
    } catch (e) { next(e); }
  });

  /** The token is returned here and never again: only its hash is stored. */
  router.post('/tokens', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const raw = (req.body as { name?: unknown } | undefined)?.name;
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name || name.length > 40) return res.status(400).json({ error: 'Give the token a name of up to 40 characters.' });
      const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM agent_tokens WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      if (cnt[0].n >= MAX_ACTIVE_TOKENS) return res.status(409).json({ error: `You can have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.` });
      const token = newAgentToken();
      const { rows } = await pool.query(
        'INSERT INTO agent_tokens (user_id, name, token_hash, hint) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
        [userId, name, sha(token), token.slice(-4)]);
      res.status(201).json({ id: String(rows[0].id), name, hint: token.slice(-4), createdAt: rows[0].created_at, token });
    } catch (e) { next(e); }
  });

  router.delete('/tokens/:id', requireAuth, async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const r = await pool.query('UPDATE agent_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [/^\d{1,18}$/.test(id) ? id : '0', userIdOf(req)]);
      if (!r.rowCount) return res.status(404).json({ error: 'Token not found' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ── agent (bearer token) ── */

  router.post('/heartbeat', requireAgent, async (req, res, next) => {
    try {
      const b = (req.body ?? {}) as { version?: unknown; state?: unknown };
      const version = typeof b.version === 'string' ? b.version.slice(0, 40) : '';
      const state: AgentState = AGENT_STATES.includes(b.state as AgentState) ? (b.state as AgentState) : 'idle';
      const userId = (req as AgentReq).agentUserId;
      await pool.query(
        `INSERT INTO agent_status (user_id, last_seen_at, version, state) VALUES ($1, now(), $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now(), version=$2, state=$3`,
        [userId, version, state]);
      // lets the agent fetch orders only when there are some, instead of polling for them on every beat
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM agent_commands WHERE user_id=$1 AND status='pending' AND created_at > now() - interval '${COMMAND_TTL_HOURS} hours'`, [userId]);
      res.json({ ok: true, serverTime: new Date().toISOString(), pendingCommands: rows[0].n });
    } catch (e) { next(e); }
  });

  /* ── alerts, diagnoses and proposed fixes ── */

  const agentUser = agentUserOf;
  const idOf = (v: unknown) => { const s = String(v); return /^\d{1,18}$/.test(s) ? s : null; };
  /** A trimmed string of 1..max characters, else null. */
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);
  const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list.includes(v as T) ? (v as T) : null);
  const when = (v: unknown): Date | null => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isNaN(t) ? null : new Date(t); };
  /** Sends the 422 and returns true when the text looks like it contains a credential. */
  const leaks = (res: Response, ...texts: string[]): boolean => {
    for (const t of texts) {
      const kind = findSecret(t);
      if (kind) { res.status(422).json({ error: `This looks like it contains a ${kind}. Remove it and send again.` }); return true; }
    }
    return false;
  };
  const ownsAlert = async (alertId: string, userId: number) =>
    (await pool.query('SELECT 1 FROM agent_alerts WHERE id=$1 AND user_id=$2', [alertId, userId])).rowCount === 1;

  /** Create or update an alert, keyed by its Rollbar id. Fields left out keep their current value. */
  router.post('/alerts', requireAgent, async (req, res, next) => {
    try {
      const userId = agentUser(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const externalId = typeof b.externalId === 'string' && EXTERNAL_ID.test(b.externalId) ? b.externalId : null;
      const title = str(b.title, 200);
      const category = oneOf(CATEGORIES, b.category);
      const severity = oneOf(SEVERITIES, b.severity);
      const status = b.status === undefined ? null : oneOf(ALERT_STATUSES, b.status);
      const summary = b.summary === undefined ? null : (b.summary === '' ? '' : str(b.summary, 2000));
      const occurrences = b.occurrences === undefined ? 1 : b.occurrences;
      const first = b.firstSeenAt === undefined ? null : when(b.firstSeenAt);
      const last = b.lastSeenAt === undefined ? null : when(b.lastSeenAt);
      if (!externalId || !title || !category || !severity) return res.status(400).json({ error: 'externalId, title, category and severity are required.' });
      if (b.status !== undefined && !status) return res.status(400).json({ error: 'Unknown status.' });
      if (b.summary !== undefined && summary === null) return res.status(400).json({ error: 'summary must be at most 2000 characters.' });
      if (!Number.isInteger(occurrences) || (occurrences as number) < 0 || (occurrences as number) > 10_000_000) return res.status(400).json({ error: 'occurrences must be a whole number.' });
      if ((b.firstSeenAt !== undefined && !first) || (b.lastSeenAt !== undefined && !last)) return res.status(400).json({ error: 'Dates must be ISO strings.' });
      if (leaks(res, title, summary ?? '')) return;

      const known = await pool.query('SELECT 1 FROM agent_alerts WHERE user_id=$1 AND external_id=$2', [userId, externalId]);
      if (!known.rowCount) {
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM agent_alerts WHERE user_id=$1', [userId]);
        if (rows[0].n >= MAX_ALERTS) return res.status(409).json({ error: 'Too many alerts stored. Resolve or wait for old ones to expire.' });
      }
      const { rows } = await pool.query(
        `INSERT INTO agent_alerts (user_id, external_id, title, category, severity, status, occurrences, summary, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::text,'open'),$7,COALESCE($8::text,''),COALESCE($9::timestamptz,now()),COALESCE($10::timestamptz,now()))
         ON CONFLICT (user_id, external_id) DO UPDATE SET
           title=$3, category=$4, severity=$5, status=COALESCE($6::text, agent_alerts.status), occurrences=$7,
           summary=COALESCE($8::text, agent_alerts.summary),
           first_seen_at=LEAST(agent_alerts.first_seen_at, COALESCE($9::timestamptz, agent_alerts.first_seen_at)),
           last_seen_at=COALESCE($10::timestamptz, now()), updated_at=now()
         RETURNING id`,
        [userId, externalId, title, category, severity, status, occurrences, summary, first, last]);
      res.json({ id: String(rows[0].id) });
    } catch (e) { next(e); }
  });

  router.post('/alerts/:id/findings', requireAgent, async (req, res, next) => {
    try {
      const userId = agentUser(req);
      const alertId = idOf(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const text = str(b.text, 2000);
      const kind = b.kind === undefined ? 'note' : oneOf(FINDING_KINDS, b.kind);
      if (!text || !kind) return res.status(400).json({ error: 'text (up to 2000 characters) is required; kind is one of ' + FINDING_KINDS.join(', ') + '.' });
      if (leaks(res, text)) return;
      if (!alertId || !(await ownsAlert(alertId, userId))) return res.status(404).json({ error: 'Alert not found' });
      // a new analysis replaces the previous one instead of piling up next to it: the agent asks for it on the first finding of a run
      if (b.replace === true) await pool.query('DELETE FROM agent_findings WHERE alert_id=$1', [alertId]);
      const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM agent_findings WHERE alert_id=$1', [alertId]);
      if (cnt[0].n >= MAX_FINDINGS_PER_ALERT) return res.status(409).json({ error: 'This alert already has the maximum number of findings.' });
      const { rows } = await pool.query('INSERT INTO agent_findings (alert_id, kind, text) VALUES ($1,$2,$3) RETURNING id', [alertId, kind, text]);
      res.status(201).json({ id: String(rows[0].id) });
    } catch (e) { next(e); }
  });

  /** A proposed fix as plain text. Short-lived and size-capped; the agent must have scanned it for secrets, and so does the server. */
  router.post('/alerts/:id/patches', requireAgent, async (req, res, next) => {
    try {
      const userId = agentUser(req);
      const alertId = idOf(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const title = str(b.title, 120);
      const filePath = str(b.filePath, 300);
      const testCommand = b.testCommand === undefined || b.testCommand === '' ? '' : str(b.testCommand, 300);
      const body = typeof b.body === 'string' && b.body.trim() ? b.body : null;
      if (!title || !filePath || testCommand === null || !body) return res.status(400).json({ error: 'title, filePath and body are required.' });
      if (Buffer.byteLength(body) > MAX_PATCH_BYTES) return res.status(413).json({ error: `A fix can be at most ${MAX_PATCH_BYTES / 1024} KB.` });
      if (leaks(res, title, filePath, testCommand, body)) return;
      if (!alertId || !(await ownsAlert(alertId, userId))) return res.status(404).json({ error: 'Alert not found' });
      await purgeAgentData(pool);
      const { rows: cnt } = await pool.query(
        'SELECT count(*)::int AS n FROM agent_patches p JOIN agent_alerts a ON a.id=p.alert_id WHERE a.user_id=$1', [userId]);
      if (cnt[0].n >= MAX_LIVE_PATCHES) return res.status(409).json({ error: 'Too many fixes waiting. Apply or ignore some first.' });
      const { rows } = await pool.query(
        `INSERT INTO agent_patches (alert_id, title, file_path, body, test_command, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + interval '${PATCH_TTL_DAYS} days') RETURNING id, expires_at`,
        [alertId, title, filePath, body, testCommand]);
      res.status(201).json({ id: String(rows[0].id), expiresAt: rows[0].expires_at });
    } catch (e) { next(e); }
  });

  /* owner (signed-in session): read alerts and fixes, mark a fix as applied or ignored */

  router.get('/alerts', requireAuth, async (req, res, next) => {
    try {
      await purgeAgentData(pool);
      const { rows } = await pool.query(
        `SELECT a.id, a.external_id, a.title, a.category, a.severity, a.status, a.occurrences, a.summary, a.first_seen_at, a.last_seen_at,
                (SELECT count(*)::int FROM agent_patches p WHERE p.alert_id=a.id AND p.status='proposed') AS open_patches,
                (SELECT count(*)::int FROM agent_findings f WHERE f.alert_id=a.id AND f.kind='cause') AS causes,
                (SELECT count(*)::int FROM agent_findings f WHERE f.alert_id=a.id AND f.kind='noise') AS noise,
                (SELECT count(*)::int FROM agent_findings f WHERE f.alert_id=a.id AND f.kind='lead') AS leads,
                (SELECT count(*)::int FROM agent_findings f WHERE f.alert_id=a.id AND f.kind IN ('note','todo') AND f.text NOT LIKE '${FAILED_NOTE}%') AS notes,
                (SELECT count(*)::int FROM agent_findings f WHERE f.alert_id=a.id AND f.kind='note' AND f.text LIKE '${FAILED_NOTE}%') AS failed_notes
         FROM agent_alerts a WHERE a.user_id=$1
         ORDER BY (a.status IN ('resolved','ignored')),
                  array_position(ARRAY['critical','high','medium','low'], a.severity), a.last_seen_at DESC
         LIMIT 200`, [userIdOf(req)]);
      res.json({
        alerts: rows.map((r) => ({
          id: String(r.id), externalId: r.external_id, title: r.title, category: r.category, severity: r.severity, status: r.status,
          occurrences: r.occurrences, summary: r.summary, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, openPatches: r.open_patches,
          causes: r.causes, noise: r.noise, leads: r.leads, notes: r.notes, failedNotes: r.failed_notes,
        })),
      });
    } catch (e) { next(e); }
  });

  /** Removes the demo alerts the agent makes up before it is connected to Rollbar (external ids "sim-…"), with their findings, fixes and orders. */
  router.delete('/alerts/simulated', requireAuth, async (req, res, next) => {
    try {
      const r = await pool.query("DELETE FROM agent_alerts WHERE user_id=$1 AND external_id LIKE 'sim-%'", [userIdOf(req)]);
      res.json({ deleted: r.rowCount ?? 0 });
    } catch (e) { next(e); }
  });

  router.get('/alerts/:id', requireAuth, async (req, res, next) => {
    try {
      await purgeAgentData(pool);
      const id = idOf(req.params.id);
      const alert = id ? await pool.query('SELECT * FROM agent_alerts WHERE id=$1 AND user_id=$2', [id, userIdOf(req)]) : null;
      if (!alert?.rows[0]) return res.status(404).json({ error: 'Alert not found' });
      const [findings, patches] = await Promise.all([
        pool.query('SELECT id, kind, text, created_at FROM agent_findings WHERE alert_id=$1 ORDER BY id', [id]),
        pool.query('SELECT id, title, file_path, body, test_command, status, created_at, expires_at FROM agent_patches WHERE alert_id=$1 ORDER BY id DESC', [id]),
      ]);
      const a = alert.rows[0];
      res.json({
        alert: {
          id: String(a.id), externalId: a.external_id, title: a.title, category: a.category, severity: a.severity, status: a.status,
          occurrences: a.occurrences, summary: a.summary, firstSeenAt: a.first_seen_at, lastSeenAt: a.last_seen_at,
        },
        findings: findings.rows.map((f) => ({ id: String(f.id), kind: f.kind, text: f.text, createdAt: f.created_at })),
        patches: patches.rows.map((p) => ({
          id: String(p.id), title: p.title, filePath: p.file_path, body: p.body, testCommand: p.test_command, status: p.status,
          createdAt: p.created_at, expiresAt: p.expires_at,
        })),
      });
    } catch (e) { next(e); }
  });

  /** Applying or ignoring a fix wipes its text from the server straight away; only the title and file name stay as history. */
  router.patch('/patches/:id', requireAuth, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const status = oneOf(PATCH_RESOLUTIONS, (req.body as { status?: unknown } | undefined)?.status);
      if (!status) return res.status(400).json({ error: 'status must be applied or ignored.' });
      const r = id ? await pool.query(
        `UPDATE agent_patches p SET status=$1, body='' FROM agent_alerts a
         WHERE p.id=$2 AND p.alert_id=a.id AND a.user_id=$3 AND p.status='proposed'`, [status, id, userIdOf(req)]) : null;
      if (!r?.rowCount) return res.status(404).json({ error: 'Fix not found, or already handled.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ── orders from the owner to the agent ── */

  const commandJson = (r: Record<string, unknown>) => ({
    id: String(r.id), kind: r.kind, alertId: r.alert_id == null ? null : String(r.alert_id), alertTitle: r.alert_title ?? null,
    status: r.status, result: r.result, createdAt: r.created_at, finishedAt: r.finished_at,
  });

  /** Owner gives an order. Asking again for something already waiting returns the waiting one. */
  router.post('/commands', requireAuth, async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const kind = oneOf(COMMAND_KINDS, b.kind);
      if (!kind) return res.status(400).json({ error: `kind must be one of: ${COMMAND_KINDS.join(', ')}.` });
      let alertId: string | null = null;
      if (ALERT_COMMANDS.includes(kind)) {
        alertId = idOf(b.alertId);
        if (!alertId || !(await ownsAlert(alertId, userId))) return res.status(404).json({ error: 'Alert not found' });
      } else if (b.alertId !== undefined) {
        return res.status(400).json({ error: `${kind} applies to the whole agent, not to an alert.` });
      }
      await purgeAgentData(pool);
      const dup = await pool.query(
        "SELECT id FROM agent_commands WHERE user_id=$1 AND kind=$2 AND alert_id IS NOT DISTINCT FROM $3::bigint AND status IN ('pending','acked') LIMIT 1",
        [userId, kind, alertId]);
      if (dup.rows[0]) return res.json({ id: String(dup.rows[0].id), alreadyQueued: true });
      const { rows: cnt } = await pool.query("SELECT count(*)::int AS n FROM agent_commands WHERE user_id=$1 AND status='pending'", [userId]);
      if (cnt[0].n >= MAX_PENDING_COMMANDS) return res.status(409).json({ error: 'Too many orders are waiting for the agent.' });
      const { rows } = await pool.query('INSERT INTO agent_commands (user_id, kind, alert_id) VALUES ($1,$2,$3) RETURNING id', [userId, kind, alertId]);
      // ignoring is shown straight away; the order then tells the agent to stop working on it
      if (kind === 'ignore') await pool.query("UPDATE agent_alerts SET status='ignored', updated_at=now() WHERE id=$1", [alertId]);
      res.status(201).json({ id: String(rows[0].id) });
    } catch (e) { next(e); }
  });

  router.get('/commands', requireAuth, async (req, res, next) => {
    try {
      await purgeAgentData(pool);
      const { rows } = await pool.query(
        `SELECT c.id, c.kind, c.alert_id, a.title AS alert_title, c.status, c.result, c.created_at, c.finished_at
         FROM agent_commands c LEFT JOIN agent_alerts a ON a.id=c.alert_id
         WHERE c.user_id=$1 ORDER BY c.id DESC LIMIT 50`, [userIdOf(req)]);
      res.json({ commands: rows.map(commandJson) });
    } catch (e) { next(e); }
  });

  /** Take back an order the agent has not picked up yet. */
  router.post('/commands/:id/cancel', requireAuth, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const r = id ? await pool.query(
        "UPDATE agent_commands SET status='cancelled', finished_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'", [id, userIdOf(req)]) : null;
      if (!r?.rowCount) return res.status(404).json({ error: 'Order not found, or the agent already took it.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /** The agent's waiting orders, oldest first. Reading them changes nothing, so a failed poll can simply be repeated. */
  router.get('/commands/pending', requireAgent, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.id, c.kind, c.alert_id, a.external_id, c.created_at
         FROM agent_commands c LEFT JOIN agent_alerts a ON a.id=c.alert_id
         WHERE c.user_id=$1 AND c.status='pending' AND c.created_at > now() - interval '${COMMAND_TTL_HOURS} hours'
         ORDER BY c.id LIMIT 20`, [agentUser(req)]);
      res.json({
        commands: rows.map((r) => ({
          id: String(r.id), kind: r.kind, alertId: r.alert_id == null ? null : String(r.alert_id), externalId: r.external_id ?? null, createdAt: r.created_at,
        })),
      });
    } catch (e) { next(e); }
  });

  router.post('/commands/:id/ack', requireAgent, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const cur = id ? await pool.query('SELECT status FROM agent_commands WHERE id=$1 AND user_id=$2', [id, agentUser(req)]) : null;
      const status = cur?.rows[0]?.status as string | undefined;
      if (!status) return res.status(404).json({ error: 'Order not found' });
      if (status === 'acked') return res.json({ ok: true }); // acknowledging twice is harmless
      if (status !== 'pending') return res.status(409).json({ error: `This order is ${status}.` });
      await pool.query("UPDATE agent_commands SET status='acked', acked_at=now() WHERE id=$1 AND status='pending'", [id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.post('/commands/:id/result', requireAgent, async (req, res, next) => {
    try {
      const id = idOf(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const status = oneOf(COMMAND_RESULTS, b.status);
      const result = b.result === undefined || b.result === '' ? '' : str(b.result, 500);
      if (!status || result === null) return res.status(400).json({ error: 'status must be done or failed; result is up to 500 characters.' });
      if (leaks(res, result)) return;
      const r = id ? await pool.query(
        "UPDATE agent_commands SET status=$3, result=$4, finished_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','acked')",
        [id, agentUser(req), status, result]) : null;
      if (!r?.rowCount) return res.status(409).json({ error: 'Order not found, or already finished.' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}
