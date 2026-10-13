import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type pg from 'pg';
import { isValidTimeZone } from './time';
import type { Sender } from './push';
import { feedRouter } from './feeds';
import { safeFetchText, type FeedFetcher } from './feedFetch';

const COOKIE = 'lifeos_session';
const SESSION_DAYS = 30;
const MAX_BACKUPS = 20;
const BACKUP_EVERY_MS = 60 * 60 * 1000;
/** Real bcrypt hash of a random string; compared against when the email is unknown so timing doesn't reveal accounts. */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

export interface AppOptions {
  pool: pg.Pool;
  /** Serve this directory (the built client) when set. */
  staticDir?: string;
  /** Mark cookies Secure (set when behind HTTPS). */
  secureCookies?: boolean;
  /** Allow creating further accounts after the first. Off by default: LifeOS is single-user. */
  allowRegistration?: boolean;
  /** Web Push: the public VAPID key shown to browsers, and the function that delivers a push. */
  push?: { publicKey: string; send: Sender };
  /** How calendar feeds are downloaded. Defaults to the SSRF-safe fetcher; tests inject their own. */
  fetchFeed?: FeedFetcher;
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Tiny in-memory limiter for login attempts. */
function makeLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string): boolean {
      const now = Date.now();
      const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(key, list);
      return list.length <= limit;
    },
    reset(key: string) { hits.delete(key); },
  };
}

type Authed = Request & { userId: number };

export function createApp(opts: AppOptions) {
  const { pool } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  // CSRF defence in depth: cookies are SameSite=Lax; additionally require JSON on writes and a same-origin Origin header.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* invalid */ }
      const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
      if (!allowed.includes(host)) return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
    next();
  });

  const loginLimiter = makeLimiter(10, 10 * 60_000);

  const setSession = async (res: Response, userId: number) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha(token), userId, expires]);
    const flags = ['HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
    if (opts.secureCookies) flags.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
  };
  const clearSession = (res: Response) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${opts.secureCookies ? '; Secure' : ''}`);
  };

  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (!token) return res.status(401).json({ error: 'Not signed in' });
      const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at > now()', [sha(token)]);
      if (!rows[0]) { clearSession(res); return res.status(401).json({ error: 'Session expired' }); }
      (req as Authed).userId = Number(rows[0].user_id);
      next();
    } catch (e) { next(e); }
  };

  const credentials = (body: unknown): { email: string; password: string } | null => {
    const b = body as { email?: unknown; password?: unknown };
    if (typeof b?.email !== 'string' || typeof b?.password !== 'string') return null;
    const email = b.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return null;
    return { email, password: b.password };
  };

  /* ── status ── */
  app.get('/api/health', async (_req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
      res.json({ ok: true, hasUser: rows[0].n > 0, registrationOpen: rows[0].n === 0 || !!opts.allowRegistration });
    } catch (e) { next(e); }
  });

  /* ── auth ── */
  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const c = credentials(req.body);
      if (!c) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (c.password.length < 10) return res.status(400).json({ error: 'Use a password of at least 10 characters.' });
      if (c.password.length > 200) return res.status(400).json({ error: 'Password is too long.' });
      const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM users');
      if (cnt[0].n > 0 && !opts.allowRegistration) return res.status(403).json({ error: 'An account already exists. Sign in instead.' });
      const hash = await bcrypt.hash(c.password, 12);
      let userId: number;
      try {
        const { rows } = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id', [c.email, hash]);
        userId = Number(rows[0].id);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
        throw e;
      }
      await setSession(res, userId);
      res.status(201).json({ email: c.email });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const c = credentials(req.body);
      if (!c) return res.status(400).json({ error: 'Enter your email and password.' });
      const key = `${req.ip}|${c.email}`;
      if (!loginLimiter.hit(key)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE email=$1', [c.email]);
      const ok = await bcrypt.compare(c.password, rows[0]?.password_hash ?? DUMMY_HASH);
      if (!rows[0] || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
      loginLimiter.reset(key);
      await setSession(res, Number(rows[0].id));
      res.json({ email: c.email });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [sha(token)]);
      clearSession(res);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT email FROM users WHERE id=$1', [(req as Authed).userId]);
      res.json({ email: rows[0].email });
    } catch (e) { next(e); }
  });

  /* ── data ── */
  const looksLikeData = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).version === 'number';

  app.get('/api/data', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT data, revision, updated_at FROM documents WHERE user_id=$1', [(req as Authed).userId]);
      if (!rows[0]) return res.json({ data: null, revision: 0 });
      res.json({ data: rows[0].data, revision: rows[0].revision, updatedAt: rows[0].updated_at });
    } catch (e) { next(e); }
  });

  /** Optimistic concurrency: the client says which revision it last saw; a mismatch is a 409 with the server's copy. */
  app.put('/api/data', requireAuth, async (req, res, next) => {
    const userId = (req as Authed).userId;
    const { data, baseRevision, force } = req.body as { data?: unknown; baseRevision?: unknown; force?: unknown };
    if (!looksLikeData(data)) return res.status(400).json({ error: 'Body must contain LifeOS data.' });
    if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 0) return res.status(400).json({ error: 'baseRevision required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT data, revision FROM documents WHERE user_id=$1 FOR UPDATE', [userId]);
      const current = cur.rows[0];
      if (current && current.revision !== baseRevision && force !== true) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Changed elsewhere', data: current.data, revision: current.revision });
      }
      if (!current && baseRevision !== 0 && force !== true) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No saved data on the server', data: null, revision: 0 });
      }
      let revision = 1;
      if (current) {
        revision = current.revision + 1;
        // hourly rotating backup of what we're about to replace (always when overwriting a conflict)
        const last = await client.query('SELECT saved_at FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 1', [userId]);
        if (!last.rows[0] || Date.now() - new Date(last.rows[0].saved_at).getTime() > BACKUP_EVERY_MS || force === true) {
          await client.query('INSERT INTO document_backups (user_id, reason, revision, data) VALUES ($1,$2,$3,$4)',
            [userId, force === true ? 'before overwrite' : 'automatic', current.revision, JSON.stringify(current.data)]);
          await client.query(
            `DELETE FROM document_backups WHERE user_id=$1 AND id NOT IN
             (SELECT id FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC LIMIT ${MAX_BACKUPS})`, [userId]);
        }
        await client.query('UPDATE documents SET data=$2, revision=$3, updated_at=now() WHERE user_id=$1', [userId, JSON.stringify(data), revision]);
      } else {
        await client.query('INSERT INTO documents (user_id, data, revision) VALUES ($1,$2,1)', [userId, JSON.stringify(data)]);
      }
      await client.query('COMMIT');
      res.json({ revision });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      next(e);
    } finally { client.release(); }
  });

  app.get('/api/data/backups', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, reason, revision, saved_at FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC LIMIT $2', [(req as Authed).userId, MAX_BACKUPS]);
      res.json({ backups: rows.map((r) => ({ id: String(r.id), reason: r.reason, revision: r.revision, savedAt: r.saved_at })) });
    } catch (e) { next(e); }
  });

  app.get('/api/data/backups/:id', requireAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT data FROM document_backups WHERE id=$1 AND user_id=$2', [req.params.id, (req as Authed).userId]);
      if (!rows[0]) return res.status(404).json({ error: 'Backup not found' });
      res.json({ data: rows[0].data });
    } catch (e) { next(e); }
  });

  /* ── push ── */
  app.get('/api/push/key', requireAuth, (_req, res) => {
    if (!opts.push) return res.status(404).json({ error: 'Push is not configured on this server.' });
    res.json({ publicKey: opts.push.publicKey });
  });

  app.post('/api/push/subscribe', requireAuth, async (req, res, next) => {
    try {
      const { subscription, tz } = req.body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; tz?: unknown };
      const endpoint = subscription?.endpoint, p256dh = subscription?.keys?.p256dh, auth = subscription?.keys?.auth;
      if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string' || endpoint.length > 2048) {
        return res.status(400).json({ error: 'A valid push subscription is required.' });
      }
      try { if (new URL(endpoint).protocol !== 'https:') throw new Error('not https'); } catch { return res.status(400).json({ error: 'Push endpoint must be an https URL.' }); }
      if (!isValidTimeZone(tz)) return res.status(400).json({ error: 'A valid time zone is required.' });
      await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, tz) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4, tz=$5`,
        [(req as Authed).userId, endpoint, p256dh, auth, tz]);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  app.post('/api/push/unsubscribe', requireAuth, async (req, res, next) => {
    try {
      const { endpoint } = req.body as { endpoint?: unknown };
      if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });
      await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, (req as Authed).userId]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.post('/api/push/test', requireAuth, async (req, res, next) => {
    try {
      if (!opts.push) return res.status(404).json({ error: 'Push is not configured on this server.' });
      const { rows } = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1', [(req as Authed).userId]);
      if (!rows.length) return res.status(409).json({ error: 'No device is subscribed yet.' });
      let delivered = 0;
      for (const s of rows) {
        const r = await opts.push.send(s, { title: 'LifeOS', body: 'Background reminders are working.', tag: 'lifeos-test', url: '/' });
        if (r === 'ok') delivered++;
        if (r === 'gone') await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [s.id]);
      }
      res.json({ delivered, devices: rows.length });
    } catch (e) { next(e); }
  });

  /* ── calendar feeds (read-only iCal subscriptions) ── */
  app.use('/api/feeds', feedRouter(pool, requireAuth, (req) => (req as Authed).userId, opts.fetchFeed ?? safeFetchText));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
    // single-page-app fallback (Express 5 no longer accepts a bare '*' route pattern)
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile('index.html', { root: opts.staticDir });
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
