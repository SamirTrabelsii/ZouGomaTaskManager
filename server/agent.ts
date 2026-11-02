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
`;

export const TOKEN_PREFIX = 'lifeos_agent_';
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

type AgentReq = Request & { agentUserId: number };

export function agentRouter(
  pool: pg.Pool,
  requireAuth: RequestHandler,
  userIdOf: (req: Request) => number,
  limits: { perToken: Limiter; failures: Limiter },
) {
  const router = Router();

  /** Bearer-token auth for the agent. Ignores cookies on purpose, so a browser session can never act as the agent. */
  const requireAgent = async (req: Request, res: Response, next: NextFunction) => {
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
      next();
    } catch (e) { next(e); }
  };

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
      await pool.query(
        `INSERT INTO agent_status (user_id, last_seen_at, version, state) VALUES ($1, now(), $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now(), version=$2, state=$3`,
        [(req as AgentReq).agentUserId, version, state]);
      res.json({ ok: true, serverTime: new Date().toISOString() });
    } catch (e) { next(e); }
  });

  return router;
}
