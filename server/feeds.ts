import express, { type RequestHandler } from 'express';
import type pg from 'pg';
import { FeedError, normaliseFeedUrl, safeFetchText, type FeedFetcher } from './feedFetch';
import { approxMs, parseIcs } from './ical';
import { zonedToInstant } from './time';
import type { PushPayload, PushSubscriptionRow, Sender } from './push';

export const FEEDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS calendar_feeds (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL,
  url             TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  warnings        TEXT[] NOT NULL DEFAULT '{}'
);
-- minutes before a meeting to push a reminder (NULL = no reminders for this calendar)
ALTER TABLE calendar_feeds ADD COLUMN IF NOT EXISTS remind_before INTEGER;
CREATE INDEX IF NOT EXISTS calendar_feeds_user_idx ON calendar_feeds(user_id);
CREATE TABLE IF NOT EXISTS feed_events (
  feed_id     BIGINT NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  uid         TEXT NOT NULL,
  occ         TEXT NOT NULL,
  title       TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  all_day     BOOLEAN NOT NULL,
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  PRIMARY KEY (feed_id, uid, occ)
);
-- one row per (meeting instance, start time): a moved meeting has a new start, which re-arms its reminder
CREATE TABLE IF NOT EXISTS feed_reminders_sent (
  feed_id BIGINT NOT NULL REFERENCES calendar_feeds(id) ON DELETE CASCADE,
  uid     TEXT NOT NULL,
  occ     TEXT NOT NULL,
  starts  TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feed_id, uid, occ, starts)
);
`;

/** Choices offered for "remind me before a meeting", in minutes. */
export const REMIND_CHOICES = [0, 5, 10, 15, 30, 60] as const;

/** How often each calendar is re-downloaded. Hosted setups with a scale-to-zero database raise this (FEED_SYNC_MINUTES). */
export const SYNC_EVERY_MS = (Number(process.env.FEED_SYNC_MINUTES) > 0 ? Number(process.env.FEED_SYNC_MINUTES) : 15) * 60_000;
export const MAX_FEEDS = 10;
const MANUAL_REFRESH_MIN_MS = 30_000;
const PAST_DAYS = 60;
const FUTURE_DAYS = 400;

interface FeedRow {
  id: string; user_id: string; name: string; color: string; url: string;
  last_attempt_at: Date | null; last_sync_at: Date | null; last_error: string | null; warnings: string[]; remind_before: number | null;
}

/**
 * Download, parse and store one feed. The stored events are replaced as a whole, so cancelled, moved and deleted meetings
 * disappear and nothing can be duplicated. If the download or parse fails the previous events are kept and the error is recorded.
 */
export async function syncFeed(pool: pg.Pool, feed: Pick<FeedRow, 'id' | 'url'>, fetchText: FeedFetcher, now = Date.now()): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await pool.query('UPDATE calendar_feeds SET last_attempt_at=$2 WHERE id=$1', [feed.id, new Date(now)]);
  try {
    const text = await fetchText(feed.url);
    let parsed;
    try {
      parsed = parseIcs(text, { from: now - PAST_DAYS * 86400_000, to: now + FUTURE_DAYS * 86400_000 });
    } catch {
      throw new FeedError('The calendar could not be understood. Is it an .ics link?');
    }
    const warnings = [...parsed.warnings];
    if (parsed.truncated) warnings.push('The calendar has a very large number of meetings; only the first ones are shown.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM feed_events WHERE feed_id=$1', [feed.id]);
      const o = parsed.occurrences;
      for (let i = 0; i < o.length; i += 500) {
        const part = o.slice(i, i + 500);
        await client.query(
          `INSERT INTO feed_events (feed_id, uid, occ, title, location, description, all_day, starts, ends)
           SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::bool[], $8::text[], $9::text[])
           ON CONFLICT DO NOTHING`,
          [feed.id, part.map((e) => e.uid), part.map((e) => e.occ), part.map((e) => e.title), part.map((e) => e.location),
            part.map((e) => e.description), part.map((e) => e.allDay), part.map((e) => e.start), part.map((e) => e.end)]);
      }
      await client.query('UPDATE calendar_feeds SET last_sync_at=$2, last_error=NULL, warnings=$3 WHERE id=$1', [feed.id, new Date(now), warnings]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    return { ok: true, count: parsed.occurrences.length };
  } catch (e) {
    const error = e instanceof FeedError ? e.message : 'Something went wrong while updating this calendar.';
    // log the kind of failure only: error messages from the network layer can contain the (secret) feed URL
    if (!(e instanceof FeedError)) console.error(`feed ${feed.id} sync failed:`, (e as { code?: string }).code ?? (e as Error).name);
    await pool.query('UPDATE calendar_feeds SET last_error=$2 WHERE id=$1', [feed.id, error]);
    return { ok: false, error };
  }
}

/** Sync every feed that has not been tried for `everyMs`. Each feed is claimed first so overlapping runs never double-fetch. */
export async function runDueFeeds(pool: pg.Pool, fetchText: FeedFetcher, now = Date.now(), everyMs = SYNC_EVERY_MS): Promise<number> {
  const { rows } = await pool.query<FeedRow>(
    'SELECT id, url FROM calendar_feeds WHERE last_attempt_at IS NULL OR last_attempt_at <= $1 ORDER BY id', [new Date(now - everyMs)]);
  let n = 0;
  for (const f of rows) {
    const claim = await pool.query('UPDATE calendar_feeds SET last_attempt_at=$2 WHERE id=$1 AND (last_attempt_at IS NULL OR last_attempt_at <= $3)', [f.id, new Date(now), new Date(now - everyMs)]);
    if (!claim.rowCount) continue;
    await syncFeed(pool, f, fetchText, now);
    n++;
  }
  return n;
}

/** When the next feed sync is due (an unsynced feed is due now); null when there are no feeds. */
export async function nextFeedSyncAt(pool: pg.Pool, everyMs = SYNC_EVERY_MS): Promise<number | null> {
  const { rows } = await pool.query<{ n: string; oldest: Date | null }>('SELECT count(*) AS n, min(coalesce(last_attempt_at, to_timestamp(0))) AS oldest FROM calendar_feeds');
  if (!Number(rows[0].n) || !rows[0].oldest) return null;
  return rows[0].oldest.getTime() + everyMs;
}

/** The earliest moment after `now` at which a meeting reminder becomes due (meeting start minus lead), looking `horizonMs` ahead. */
export async function nextFeedReminderAt(pool: pg.Pool, now = Date.now(), horizonMs = 24 * 3600_000): Promise<number | null> {
  const { rows: feeds } = await pool.query<{ id: string; user_id: string; remind_before: number }>(
    'SELECT id, user_id, remind_before FROM calendar_feeds WHERE remind_before IS NOT NULL');
  if (!feeds.length) return null;
  const { rows: subs } = await pool.query<PushSubscriptionRow>(
    'SELECT id, user_id, endpoint, p256dh, auth, tz FROM push_subscriptions WHERE user_id = ANY($1::bigint[])', [[...new Set(feeds.map((f) => f.user_id))]]);
  let next: number | null = null;
  for (const feed of feeds) {
    const userSubs = subs.filter((s) => String(s.user_id) === String(feed.user_id));
    if (!userSubs.length) continue;
    const tz = userSubs[0].tz;
    const lead = feed.remind_before * 60_000;
    const lo = new Date(now - 86400_000).toISOString().slice(0, 19), hi = new Date(now + horizonMs + lead + 86400_000).toISOString().slice(0, 19);
    const { rows } = await pool.query<{ starts: string }>(
      'SELECT starts FROM feed_events WHERE feed_id=$1 AND NOT all_day AND substr(starts,1,19) BETWEEN $2 AND $3', [feed.id, lo, hi]);
    for (const e of rows) {
      const start = e.starts.endsWith('Z') ? Date.parse(e.starts) : zonedToInstant(e.starts, tz);
      if (start === null || Number.isNaN(start)) continue;
      const due = start - lead;
      if (due > now && (next === null || due < next)) next = due;
    }
  }
  return next;
}

/**
 * Pushes a reminder for each timed meeting of a feed that has reminders on, `remind_before` minutes ahead of its start,
 * once per (meeting, start time). Meetings that already started are skipped (a late "starts in 5 min" would be wrong).
 * Reads the stored meetings only; like the reminder push it never touches the user's own data.
 */
export async function runDueFeedReminders(pool: pg.Pool, send: Sender, now = Date.now()): Promise<{ sent: number }> {
  const { rows: feeds } = await pool.query<{ id: string; user_id: string; name: string; remind_before: number }>(
    'SELECT id, user_id, name, remind_before FROM calendar_feeds WHERE remind_before IS NOT NULL ORDER BY id');
  if (!feeds.length) return { sent: 0 };
  const { rows: subs } = await pool.query<PushSubscriptionRow>(
    'SELECT id, user_id, endpoint, p256dh, auth, tz FROM push_subscriptions WHERE user_id = ANY($1::bigint[])', [[...new Set(feeds.map((f) => f.user_id))]]);
  let sent = 0;
  for (const feed of feeds) {
    const userSubs = subs.filter((s) => String(s.user_id) === String(feed.user_id));
    if (!userSubs.length) continue; // no device to notify
    const tz = userSubs[0].tz; // floating (zone-less) meeting times are read in the user's zone
    const lead = feed.remind_before * 60_000;
    // coarse text filter (a day of slack for zone offsets); the exact check is done on real instants below
    const lo = new Date(now - 86400_000).toISOString().slice(0, 19), hi = new Date(now + lead + 86400_000).toISOString().slice(0, 19);
    const { rows } = await pool.query<{ uid: string; occ: string; title: string; location: string; starts: string }>(
      'SELECT uid, occ, title, location, starts FROM feed_events WHERE feed_id=$1 AND NOT all_day AND substr(starts,1,19) BETWEEN $2 AND $3', [feed.id, lo, hi]);
    for (const e of rows) {
      const start = e.starts.endsWith('Z') ? Date.parse(e.starts) : zonedToInstant(e.starts, tz);
      if (start === null || Number.isNaN(start)) continue;
      if (now < start - lead || now > start) continue;
      // claim first, so overlapping runs can't double-send
      const claim = await pool.query('INSERT INTO feed_reminders_sent (feed_id, uid, occ, starts) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [feed.id, e.uid, e.occ, e.starts]);
      if (!claim.rowCount) continue;
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(start));
      const payload: PushPayload = {
        title: e.title.slice(0, 120),
        body: [`Starts at ${time}`, e.location.slice(0, 80), feed.name].filter(Boolean).join(' · '),
        tag: `lifeos-feed-${feed.id}-${start}`, url: '/',
      };
      for (const s of userSubs) {
        const r = await send(s, payload);
        if (r === 'gone') await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [s.id]);
        else if (r === 'ok') sent++;
      }
    }
  }
  await pool.query("DELETE FROM feed_reminders_sent WHERE sent_at < now() - interval '30 days'");
  return { sent };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

const publicFeed = (r: FeedRow & { event_count?: string | number }) => {
  let host = '';
  try { host = new URL(r.url).hostname; } catch { /* keep empty */ }
  return {
    id: String(r.id), name: r.name, color: r.color, host,
    lastSyncAt: r.last_sync_at, lastError: r.last_error, warnings: r.warnings ?? [],
    eventCount: Number(r.event_count ?? 0), remindBefore: r.remind_before ?? null,
  };
};

/** Same meeting seen through two feeds (e.g. a Google invite also in Outlook) is shown once. */
export function dedupeAcrossFeeds<T extends { feedId: string; uid: string; title: string; start: string; end: string }>(events: T[]): T[] {
  const seen = new Map<string, string>(); // key -> feedId that owns it
  return events.filter((e) => {
    for (const key of [`u|${e.uid}|${e.start}`, `t|${e.title.trim().toLowerCase()}|${e.start}|${e.end}`]) {
      const owner = seen.get(key);
      if (owner !== undefined && owner !== e.feedId) return false;
    }
    for (const key of [`u|${e.uid}|${e.start}`, `t|${e.title.trim().toLowerCase()}|${e.start}|${e.end}`]) if (!seen.has(key)) seen.set(key, e.feedId);
    return true;
  });
}

export function feedRouter(pool: pg.Pool, requireAuth: RequestHandler, userIdOf: (req: express.Request) => number, fetchText: FeedFetcher): express.Router {
  const r = express.Router();
  r.use(requireAuth);

  const list = async (userId: number) => {
    const { rows } = await pool.query(
      `SELECT f.*, (SELECT count(*) FROM feed_events e WHERE e.feed_id=f.id) AS event_count
       FROM calendar_feeds f WHERE f.user_id=$1 ORDER BY f.id`, [userId]);
    return rows.map(publicFeed);
  };
  const owned = async (req: express.Request): Promise<FeedRow | null> => {
    if (!/^\d{1,18}$/.test(String(req.params.id))) return null;
    const { rows } = await pool.query<FeedRow>('SELECT * FROM calendar_feeds WHERE id=$1 AND user_id=$2', [req.params.id, userIdOf(req)]);
    return rows[0] ?? null;
  };
  const cleanName = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().length <= 60 ? v.trim() : null);

  r.get('/', async (req, res, next) => {
    try { res.json({ feeds: await list(userIdOf(req)) }); } catch (e) { next(e); }
  });

  r.post('/', async (req, res, next) => {
    try {
      const userId = userIdOf(req);
      const b = req.body as { name?: unknown; color?: unknown; url?: unknown };
      const name = cleanName(b.name);
      if (!name) return res.status(400).json({ error: 'Give the calendar a name (up to 60 characters).' });
      if (typeof b.color !== 'string' || !COLOR.test(b.color)) return res.status(400).json({ error: 'Pick a colour.' });
      let url: string;
      try { url = normaliseFeedUrl(b.url); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
      const { rows: have } = await pool.query('SELECT url FROM calendar_feeds WHERE user_id=$1', [userId]);
      if (have.length >= MAX_FEEDS) return res.status(409).json({ error: `You can connect up to ${MAX_FEEDS} calendars.` });
      if (have.some((h) => h.url === url)) return res.status(409).json({ error: 'That calendar is already connected.' });
      const ins = await pool.query<FeedRow>(
        'INSERT INTO calendar_feeds (user_id, name, color, url) VALUES ($1,$2,$3,$4) RETURNING *', [userId, name, b.color.toLowerCase(), url]);
      const feed = ins.rows[0];
      // fetch right away so a wrong link is reported now, not 15 minutes later; a failure means the feed is not kept
      const result = await syncFeed(pool, feed, fetchText);
      if (!result.ok) {
        await pool.query('DELETE FROM calendar_feeds WHERE id=$1', [feed.id]);
        return res.status(422).json({ error: result.error });
      }
      const created = (await list(userId)).find((f) => f.id === String(feed.id));
      res.status(201).json({ feed: created });
    } catch (e) { next(e); }
  });

  r.patch('/:id', async (req, res, next) => {
    try {
      const feed = await owned(req);
      if (!feed) return res.status(404).json({ error: 'Calendar not found.' });
      const b = req.body as { name?: unknown; color?: unknown; remindBefore?: unknown };
      let remind = feed.remind_before;
      if (b.remindBefore !== undefined) {
        if (b.remindBefore !== null && !REMIND_CHOICES.includes(b.remindBefore as never)) return res.status(400).json({ error: 'Choose one of the reminder times.' });
        remind = b.remindBefore as number | null;
      }
      const name = b.name === undefined ? feed.name : cleanName(b.name);
      const color = b.color === undefined ? feed.color : (typeof b.color === 'string' && COLOR.test(b.color) ? b.color.toLowerCase() : null);
      if (!name || !color) return res.status(400).json({ error: 'Enter a name (up to 60 characters) and a valid colour.' });
      await pool.query('UPDATE calendar_feeds SET name=$2, color=$3, remind_before=$4 WHERE id=$1', [feed.id, name, color, remind]);
      res.json({ feed: (await list(userIdOf(req))).find((f) => f.id === String(feed.id)) });
    } catch (e) { next(e); }
  });

  r.delete('/:id', async (req, res, next) => {
    try {
      const feed = await owned(req);
      if (!feed) return res.status(404).json({ error: 'Calendar not found.' });
      await pool.query('DELETE FROM calendar_feeds WHERE id=$1', [feed.id]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.post('/:id/refresh', async (req, res, next) => {
    try {
      const feed = await owned(req);
      if (!feed) return res.status(404).json({ error: 'Calendar not found.' });
      if (feed.last_attempt_at && Date.now() - feed.last_attempt_at.getTime() < MANUAL_REFRESH_MIN_MS) {
        return res.status(429).json({ error: 'Just updated. Try again in a few seconds.' });
      }
      const result = await syncFeed(pool, feed, fetchText);
      const updated = (await list(userIdOf(req))).find((f) => f.id === String(feed.id));
      if (!result.ok) return res.status(502).json({ error: result.error, feed: updated });
      res.json({ feed: updated });
    } catch (e) { next(e); }
  });

  /** All imported meetings for all of this user's feeds (read-only, already de-duplicated). */
  r.get('/events', async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT e.feed_id, e.uid, e.occ, e.title, e.location, e.description, e.all_day, e.starts, e.ends
         FROM feed_events e JOIN calendar_feeds f ON f.id=e.feed_id WHERE f.user_id=$1 ORDER BY e.feed_id`, [userIdOf(req)]);
      const events = rows.map((x) => ({
        id: `${x.feed_id}:${x.uid}:${x.occ}`, feedId: String(x.feed_id), uid: x.uid as string, title: x.title as string,
        location: x.location as string, description: x.description as string, allDay: x.all_day as boolean, start: x.starts as string, end: x.ends as string,
      }));
      events.sort((a, b) => approxMs(a.start) - approxMs(b.start));
      res.json({ events: dedupeAcrossFeeds(events).map(({ uid: _u, ...rest }) => rest) });
    } catch (e) { next(e); }
  });

  return r;
}
