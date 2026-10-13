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

/** Recovery codes: 100 random bits as 5 groups of 4 chars (no 0/O/1/I/L), e.g. K7QM-2XWD-… . Shown once; only a SHA-256 is stored. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRecoveryCode(): string {
  // 31 symbols; rejection sampling keeps the choice uniform
  const chars: string[] = [];
  while (chars.length < 20) for (const b of crypto.randomBytes(32)) if (b < 248 && chars.length < 20) chars.push(CODE_ALPHABET[b % 31]);
  return chars.join('').match(/.{4}/g)!.join('-');
}
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (c: string) => sha('recovery:' + normalizeCode(c));
const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
  const changeLimiter = makeLimiter(5, 10 * 60_000);       // per signed-in user: password change / new recovery code
  const resetIpLimiter = makeLimiter(10, 15 * 60_000);     // recovery-code attempts per ip+email
  const resetEmailLimiter = makeLimiter(20, 60 * 60_000);  // ...and per email, so rotating IPs doesn't help

  const passwordProblem = (pw: unknown): string | null => {
    if (typeof pw !== 'string' || pw.length < 10) return 'Use a password of at least 10 characters.';
    if (pw.length > 200) return 'Password is too long.';
    return null;
  };
  /** Stores a fresh recovery code for the user and returns it (the only time it is ever visible). */
  const issueRecoveryCode = async (userId: number) => {
    const code = newRecoveryCode();
    await pool.query('UPDATE users SET recovery_hash=$2 WHERE id=$1', [userId, hashCode(code)]);
    return code;
  };

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
      const recoveryCode = await issueRecoveryCode(userId);
      await setSession(res, userId);
      res.status(201).json({ email: c.email, recoveryCode });
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
      const { rows } = await pool.query('SELECT email, recovery_hash IS NOT NULL AS has_recovery FROM users WHERE id=$1', [(req as Authed).userId]);
      res.json({ email: rows[0].email, hasRecoveryCode: rows[0].has_recovery });
    } catch (e) { next(e); }
  });

  /** Change the password while signed in. Every other session is ended; this one stays. */
  app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
    try {
      const userId = (req as Authed).userId;
      const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return res.status(400).json({ error: 'Enter your current and new password.' });
      const key = `change|${userId}`;
      if (!changeLimiter.hit(key)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      const problem = passwordProblem(newPassword);
      if (problem) return res.status(400).json({ error: problem });
      const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
      if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) return res.status(403).json({ error: 'Your current password is incorrect.' });
      if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a password different from the current one.' });
      const hash = await bcrypt.hash(newPassword, 12);
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [userId, hash]);
        const ended = await client.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [userId, sha(token)]);
        await client.query('COMMIT');
        changeLimiter.reset(key);
        res.json({ ok: true, otherSessionsEnded: ended.rowCount ?? 0 });
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    } catch (e) { next(e); }
  });

  /** Replace the recovery code (also how accounts created before recovery codes existed get one). Needs the password. */
  app.post('/api/auth/recovery-code', requireAuth, async (req, res, next) => {
    try {
      const userId = (req as Authed).userId;
      const { password } = req.body as { password?: unknown };
      if (typeof password !== 'string') return res.status(400).json({ error: 'Enter your password.' });
      const key = `change|${userId}`;
      if (!changeLimiter.hit(key)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [userId]);
      if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(403).json({ error: 'Your password is incorrect.' });
      changeLimiter.reset(key);
      res.json({ recoveryCode: await issueRecoveryCode(userId) });
    } catch (e) { next(e); }
  });

  /** Forgotten password: the recovery code proves ownership. The code is single-use (a new one is returned), all sessions end, then a fresh one starts. */
  app.post('/api/auth/reset-password', async (req, res, next) => {
    try {
      const b = req.body as { email?: unknown; recoveryCode?: unknown; newPassword?: unknown };
      const c = credentials({ email: b.email, password: 'x' });
      if (!c || typeof b.recoveryCode !== 'string' || typeof b.newPassword !== 'string') return res.status(400).json({ error: 'Enter your email, recovery code and a new password.' });
      const ipKey = `${req.ip}|${c.email}`;
      const okIp = resetIpLimiter.hit(ipKey), okEmail = resetEmailLimiter.hit(c.email);
      if (!okIp || !okEmail) return res.status(429).json({ error: 'Too many attempts. Wait a while and try again.' });
      const problem = passwordProblem(b.newPassword);
      if (problem) return res.status(400).json({ error: problem });
      const { rows } = await pool.query('SELECT id, recovery_hash FROM users WHERE email=$1', [c.email]);
      const stored: string | null = rows[0]?.recovery_hash ?? null;
      // always compare something, so an unknown email or missing code looks the same as a wrong code
      const ok = safeEqual(hashCode(b.recoveryCode), stored ?? sha('no-code'));
      if (!rows[0] || !stored || !ok) return res.status(401).json({ error: 'That email and recovery code do not match.' });
      const userId = Number(rows[0].id);
      const hash = await bcrypt.hash(b.newPassword, 12);
      const recoveryCode = newRecoveryCode();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // matching on the old recovery_hash makes the code single-use even under concurrent requests
        const upd = await client.query('UPDATE users SET password_hash=$2, recovery_hash=$3 WHERE id=$1 AND recovery_hash=$4', [userId, hash, hashCode(recoveryCode), stored]);
        if (upd.rowCount !== 1) { await client.query('ROLLBACK'); return res.status(401).json({ error: 'That email and recovery code do not match.' }); }
        await client.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
      resetIpLimiter.reset(ipKey); resetEmailLimiter.reset(c.email);
      await setSession(res, userId);
      res.json({ email: c.email, recoveryCode });
    } catch (e) { next(e); }
  });

  /** Everything the server holds for this account, as one JSON download. Secrets (password/recovery hashes, session tokens, push keys) are left out. */
  app.get('/api/account/export', requireAuth, async (req, res, next) => {
    try {
      const userId = (req as Authed).userId;
      const [user, doc, backups, subs, sessions] = await Promise.all([
        pool.query('SELECT email, created_at, recovery_hash IS NOT NULL AS has_recovery FROM users WHERE id=$1', [userId]),
        pool.query('SELECT data, revision, updated_at FROM documents WHERE user_id=$1', [userId]),
        pool.query('SELECT id, reason, revision, data, saved_at FROM document_backups WHERE user_id=$1 ORDER BY saved_at DESC', [userId]),
        pool.query('SELECT endpoint, tz, created_at FROM push_subscriptions WHERE user_id=$1 ORDER BY id', [userId]),
        pool.query('SELECT created_at, expires_at FROM sessions WHERE user_id=$1 AND expires_at > now() ORDER BY created_at', [userId]),
      ]);
      const u = user.rows[0], d = doc.rows[0];
      const exportedAt = new Date().toISOString();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="lifeos-account-${exportedAt.slice(0, 10)}.json"`);
      res.type('application/json').send(JSON.stringify({
        format: 'lifeos-account-export', formatVersion: 1, exportedAt,
        account: { email: u.email, createdAt: u.created_at, hasRecoveryCode: u.has_recovery },
        data: d ? { revision: d.revision, updatedAt: d.updated_at, data: d.data } : null,
        backups: backups.rows.map((r) => ({ id: String(r.id), reason: r.reason, revision: r.revision, savedAt: r.saved_at, data: r.data })),
        pushSubscriptions: subs.rows.map((r) => ({ endpoint: r.endpoint, timeZone: r.tz, createdAt: r.created_at })),
        activeSessions: sessions.rows.map((r) => ({ createdAt: r.created_at, expiresAt: r.expires_at })),
        notExported: 'Password and recovery-code hashes, session tokens and push encryption keys are never exported.',
      }, null, 2));
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
