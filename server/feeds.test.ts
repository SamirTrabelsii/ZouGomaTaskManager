import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { FeedError, type FeedFetcher } from './feedFetch';
import { dedupeAcrossFeeds, MAX_FEEDS, runDueFeeds, SYNC_EVERY_MS, syncFeed } from './feeds';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgres://lifeos:lifeos-dev-password@localhost:5433/lifeos_test';
const pool = createPool(URL_);
let reachable = false;
try { await pool.query('SELECT 1'); reachable = true; } catch { /* skipped below */ }

/** An iCal body with meetings a few days from now, so they fall inside the sync window whenever the test runs. */
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
const vevent = (uid: string, title: string, offset: number, hour = '09', extra = '') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${day(offset)}T${hour}0000Z\r\nDTEND:${day(offset)}T${hour}3000Z\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\n`;
const ics = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n${events.join('')}END:VCALENDAR\r\n`;

const GOOGLE = 'https://calendar.google.com/calendar/ical/me%40example.com/private-SECRETTOKEN/basic.ics';
const OUTLOOK = 'https://outlook.office365.com/owa/calendar/abc@example.com/def/calendar.ics';

describe.skipIf(!reachable)('calendar feeds API', () => {
  let server: Server;
  let base: string;
  let remote: Map<string, string | FeedError>;
  let fetched: string[];
  const fetchFeed: FeedFetcher = async (url) => {
    fetched.push(url);
    const v = remote.get(url);
    if (v === undefined) throw new FeedError('The calendar server could not be reached.');
    if (v instanceof Error) throw v;
    return v;
  };

  /** A tiny HTTP client with its own cookie jar. */
  const client = () => {
    let cookie = '';
    return async (method: string, path: string, body?: unknown) => {
      const res = await fetch(base + path, {
        method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  };
  let me: ReturnType<typeof client>;
  const add = (name: string, url: string, color = '#4f7f9c', who = me) => who('POST', '/api/feeds', { name, url, color });

  beforeAll(async () => {
    await migrate(pool);
    server = createApp({ pool, fetchFeed, allowRegistration: true }).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, sessions, documents, document_backups, calendar_feeds, feed_events RESTART IDENTITY CASCADE');
    remote = new Map(); fetched = [];
    me = client();
    expect((await me('POST', '/api/auth/register', { email: 'me@example.com', password: 'correct horse battery' })).status).toBe(201);
  });
  afterAll(async () => { server.close(); await pool.end(); });

  it('needs a signed-in user for every route', async () => {
    const anon = client();
    for (const [m, p] of [['GET', '/api/feeds'], ['POST', '/api/feeds'], ['GET', '/api/feeds/events'], ['PATCH', '/api/feeds/1'], ['DELETE', '/api/feeds/1'], ['POST', '/api/feeds/1/refresh']] as const) {
      expect((await anon(m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(401);
    }
  });

  it('adds a feed, fetches it immediately and lists its meetings', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Planning', 2), vevent('b', 'Review', 3)));
    const r = await add('Work', GOOGLE, '#4F7F9C');
    expect(r.status).toBe(201);
    expect(r.body.feed).toMatchObject({ name: 'Work', color: '#4f7f9c', host: 'calendar.google.com', eventCount: 2, lastError: null });
    const ev = (await me('GET', '/api/feeds/events')).body.events;
    expect(ev.map((e: { title: string }) => e.title)).toEqual(['Planning', 'Review']);
    expect(ev[0]).toMatchObject({ feedId: r.body.feed.id, allDay: false, start: `${day(2).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')}T09:00:00Z` });
  });

  it('never sends the secret link back to the browser', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
    const r = await add('Work', GOOGLE);
    const all = JSON.stringify([r.body, (await me('GET', '/api/feeds')).body, (await me('GET', '/api/feeds/events')).body]);
    expect(all).not.toContain('SECRETTOKEN');
    expect(all).not.toContain('private-');
  });

  it('accepts webcal:// links and stores them as https', async () => {
    remote.set(OUTLOOK, ics(vevent('a', 'Planning', 2)));
    const r = await add('Outlook', OUTLOOK.replace('https://', 'webcal://'));
    expect(r.status).toBe(201);
    expect(fetched).toEqual([OUTLOOK]);
  });

  it('supports several feeds at once, each keeping its own colour', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
    remote.set(OUTLOOK, ics(vevent('b', 'Budget', 3)));
    const g = (await add('Google', GOOGLE, '#ff0000')).body.feed;
    const o = (await add('Outlook', OUTLOOK, '#0000ff')).body.feed;
    const feeds = (await me('GET', '/api/feeds')).body.feeds;
    expect(feeds.map((f: { name: string; color: string }) => [f.name, f.color])).toEqual([['Google', '#ff0000'], ['Outlook', '#0000ff']]);
    const ev = (await me('GET', '/api/feeds/events')).body.events;
    expect(ev.map((e: { feedId: string; title: string }) => [e.feedId, e.title])).toEqual([[g.id, 'Planning'], [o.id, 'Budget']]);
  });

  it('rejects bad input without storing anything', async () => {
    remote.set(GOOGLE, ics());
    expect((await add('', GOOGLE)).status).toBe(400);
    expect((await add('x'.repeat(61), GOOGLE)).status).toBe(400);
    expect((await add('Work', GOOGLE, 'red')).status).toBe(400);
    expect((await add('Work', 'file:///etc/passwd')).status).toBe(400);
    expect((await add('Work', 'not a url')).status).toBe(400);
    expect((await me('GET', '/api/feeds')).body.feeds).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('does not keep a feed whose link does not work, and says why', async () => {
    remote.set(GOOGLE, new FeedError('That link is not an iCal (.ics) calendar.'));
    const r = await add('Work', GOOGLE);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('That link is not an iCal (.ics) calendar.');
    expect((await me('GET', '/api/feeds')).body.feeds).toEqual([]);
    remote.set(GOOGLE, '<html>nope</html>');
    expect((await add('Work', GOOGLE)).status).toBe(422);
  });

  it('refuses the same calendar twice and caps how many can be connected', async () => {
    remote.set(GOOGLE, ics());
    expect((await add('A', GOOGLE)).status).toBe(201);
    expect((await add('B', GOOGLE)).status).toBe(409);
    for (let i = 1; i < MAX_FEEDS; i++) { const u = `https://example.com/${i}.ics`; remote.set(u, ics()); expect((await add(`F${i}`, u)).status).toBe(201); }
    remote.set('https://example.com/extra.ics', ics());
    expect((await add('Too many', 'https://example.com/extra.ics')).status).toBe(409);
  });

  it('renames and recolours a feed, but not its link', async () => {
    remote.set(GOOGLE, ics());
    const id = (await add('Work', GOOGLE)).body.feed.id;
    const p = await me('PATCH', `/api/feeds/${id}`, { name: 'Job', color: '#00ff00', url: 'https://evil.example/x.ics' });
    expect(p.body.feed).toMatchObject({ name: 'Job', color: '#00ff00', host: 'calendar.google.com' });
    expect((await me('PATCH', `/api/feeds/${id}`, { color: 'nope' })).status).toBe(400);
    expect((await me('PATCH', '/api/feeds/9999', { name: 'x' })).status).toBe(404);
    expect((await me('PATCH', '/api/feeds/abc', { name: 'x' })).status).toBe(404);
  });

  it('removes a feed together with its meetings', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
    const id = (await add('Work', GOOGLE)).body.feed.id;
    expect((await me('DELETE', `/api/feeds/${id}`, {})).status).toBe(200);
    expect((await me('GET', '/api/feeds/events')).body.events).toEqual([]);
    expect((await pool.query('SELECT count(*)::int AS n FROM feed_events')).rows[0].n).toBe(0);
    expect((await me('DELETE', `/api/feeds/${id}`, {})).status).toBe(404);
  });

  it('keeps one user\'s calendars private from another', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Secret meeting', 2)));
    const id = (await add('Mine', GOOGLE)).body.feed.id;
    const other = client();
    await other('POST', '/api/auth/register', { email: 'other@example.com', password: 'another long password' });
    expect((await other('GET', '/api/feeds')).body.feeds).toEqual([]);
    expect((await other('GET', '/api/feeds/events')).body.events).toEqual([]);
    expect((await other('PATCH', `/api/feeds/${id}`, { name: 'hijack' })).status).toBe(404);
    expect((await other('DELETE', `/api/feeds/${id}`, {})).status).toBe(404);
    expect((await other('POST', `/api/feeds/${id}/refresh`, {})).status).toBe(404);
    expect((await me('GET', '/api/feeds')).body.feeds[0].name).toBe('Mine');
  });

  it('never lets the user edit imported meetings through the data document or the API', async () => {
    remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
    await add('Work', GOOGLE);
    expect((await me('PUT', '/api/feeds/events', {})).status).toBe(404);
    expect((await me('PATCH', '/api/feeds/events', { title: 'x' })).status).toBe(404);
    expect((await me('DELETE', '/api/feeds/events', {})).status).toBe(404);
    expect((await me('GET', '/api/data')).body).toEqual({ data: null, revision: 0 }); // nothing leaked into the user's own document
  });

  describe('keeping up with changes in the source calendar', () => {
    it('picks up a moved meeting without leaving the old one behind', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2, '09')));
      const f = (await add('Work', GOOGLE)).body.feed;
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 3, '14', 'SEQUENCE:1\r\n')));
      await syncFeed(pool, { id: f.id, url: GOOGLE }, fetchFeed);
      const ev = (await me('GET', '/api/feeds/events')).body.events;
      expect(ev).toHaveLength(1);
      expect(ev[0].start).toContain(`${day(3).slice(6, 8)}T14:00:00Z`);
    });

    it('drops cancelled and deleted meetings and does not duplicate unchanged ones', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Keep', 2), vevent('b', 'Cancel me', 3), vevent('c', 'Delete me', 4)));
      const f = (await add('Work', GOOGLE)).body.feed;
      remote.set(GOOGLE, ics(vevent('a', 'Keep', 2), vevent('b', 'Cancel me', 3, '09', 'STATUS:CANCELLED\r\n')));
      for (let i = 0; i < 3; i++) await syncFeed(pool, { id: f.id, url: GOOGLE }, fetchFeed); // re-syncing is idempotent
      expect((await me('GET', '/api/feeds/events')).body.events.map((e: { title: string }) => e.title)).toEqual(['Keep']);
    });

    it('keeps the last good meetings when the source is down, and records the problem', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      const f = (await add('Work', GOOGLE)).body.feed;
      remote.set(GOOGLE, new FeedError('The calendar server could not be reached.'));
      const r = await syncFeed(pool, { id: f.id, url: GOOGLE }, fetchFeed);
      expect(r).toEqual({ ok: false, error: 'The calendar server could not be reached.' });
      expect((await me('GET', '/api/feeds/events')).body.events).toHaveLength(1);
      const listed = (await me('GET', '/api/feeds')).body.feeds[0];
      expect(listed.lastError).toBe('The calendar server could not be reached.');
      expect(listed.lastSyncAt).not.toBeNull();
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      await syncFeed(pool, { id: f.id, url: GOOGLE }, fetchFeed);
      expect((await me('GET', '/api/feeds')).body.feeds[0].lastError).toBeNull();
    });

    it('keeps the last good meetings when the source returns garbage, and hides internal error details', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      const f = (await add('Work', GOOGLE)).body.feed;
      remote.set(GOOGLE, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nthis is not valid');
      const r = await syncFeed(pool, { id: f.id, url: GOOGLE }, fetchFeed);
      expect(r.ok).toBe(false);
      expect((await me('GET', '/api/feeds/events')).body.events).toHaveLength(1);
      const failing: FeedFetcher = async () => { throw new Error(`connect ECONNREFUSED ${GOOGLE}`); };
      const logged: string[] = [];
      const orig = console.error;
      console.error = (...a: unknown[]) => { logged.push(a.join(' ')); };
      let r2;
      try { r2 = await syncFeed(pool, { id: f.id, url: GOOGLE }, failing); } finally { console.error = orig; }
      expect(JSON.stringify(r2)).not.toContain('SECRETTOKEN');
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join(' ')).not.toContain('SECRETTOKEN'); // nor in the server log
    });

    it('expands recurring meetings with exceptions end-to-end', async () => {
      const d = (n: number) => day(n);
      remote.set(GOOGLE, ics(
        `BEGIN:VEVENT\r\nUID:r\r\nDTSTART:${d(1)}T080000Z\r\nDTEND:${d(1)}T083000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:${d(2)}T080000Z\r\nSUMMARY:Daily\r\nEND:VEVENT\r\n` +
        `BEGIN:VEVENT\r\nUID:r\r\nRECURRENCE-ID:${d(3)}T080000Z\r\nDTSTART:${d(3)}T150000Z\r\nDTEND:${d(3)}T153000Z\r\nSUMMARY:Daily (late)\r\nEND:VEVENT\r\n`));
      await add('Work', GOOGLE);
      const ev = (await me('GET', '/api/feeds/events')).body.events as { title: string; start: string }[];
      expect(ev.map((e) => `${e.title}@${e.start.slice(8, 13)}`)).toEqual([
        `Daily@${d(1).slice(6)}T08`, `Daily (late)@${d(3).slice(6)}T15`, `Daily@${d(4).slice(6)}T08`,
      ]);
    });
  });

  describe('the 15-minute refresh', () => {
    it('syncs a feed only when it is due, and never twice in one window', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      await add('Work', GOOGLE);
      fetched = [];
      const t0 = Date.now();
      expect(await runDueFeeds(pool, fetchFeed, t0 + 60_000)).toBe(0); // just fetched when it was added
      expect(await runDueFeeds(pool, fetchFeed, t0 + SYNC_EVERY_MS - 60_000)).toBe(0);
      expect(await runDueFeeds(pool, fetchFeed, t0 + SYNC_EVERY_MS + 60_000)).toBe(1);
      expect(await runDueFeeds(pool, fetchFeed, t0 + SYNC_EVERY_MS + 120_000)).toBe(0);
      expect(fetched).toEqual([GOOGLE]);
    });

    it('overlapping runs fetch a due feed once', async () => {
      remote.set(GOOGLE, ics());
      await add('Work', GOOGLE);
      fetched = [];
      const later = Date.now() + SYNC_EVERY_MS + 60_000;
      const [a, b] = await Promise.all([runDueFeeds(pool, fetchFeed, later), runDueFeeds(pool, fetchFeed, later)]);
      expect(a + b).toBe(1);
      expect(fetched).toHaveLength(1);
    });

    it('one broken feed does not stop the others', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      remote.set(OUTLOOK, ics(vevent('b', 'Budget', 3)));
      await add('Google', GOOGLE); await add('Outlook', OUTLOOK);
      remote.set(GOOGLE, new FeedError('The calendar server could not be reached.'));
      remote.set(OUTLOOK, ics(vevent('b', 'Budget', 3), vevent('c', 'New', 4)));
      expect(await runDueFeeds(pool, fetchFeed, Date.now() + SYNC_EVERY_MS + 60_000)).toBe(2);
      const ev = (await me('GET', '/api/feeds/events')).body.events.map((e: { title: string }) => e.title);
      expect(ev).toEqual(['Planning', 'Budget', 'New']);
    });

    it('lets the user refresh now, but not hammer the source', async () => {
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2)));
      const id = (await add('Work', GOOGLE)).body.feed.id;
      expect((await me('POST', `/api/feeds/${id}/refresh`, {})).status).toBe(429); // added a moment ago
      await pool.query("UPDATE calendar_feeds SET last_attempt_at = now() - interval '5 minutes'");
      remote.set(GOOGLE, ics(vevent('a', 'Planning', 2), vevent('b', 'Added later', 3)));
      const r = await me('POST', `/api/feeds/${id}/refresh`, {});
      expect(r.status).toBe(200);
      expect(r.body.feed.eventCount).toBe(2);
      await pool.query("UPDATE calendar_feeds SET last_attempt_at = now() - interval '5 minutes'");
      remote.set(GOOGLE, new FeedError('The calendar server could not be reached.'));
      const bad = await me('POST', `/api/feeds/${id}/refresh`, {});
      expect(bad.status).toBe(502);
      expect(bad.body.feed.lastError).toBeTruthy();
    });
  });

  it('shows one copy of a meeting that two connected calendars both contain', async () => {
    remote.set(GOOGLE, ics(vevent('same-uid', 'Team lunch', 2), vevent('g-only', 'Only Google', 3)));
    remote.set(OUTLOOK, ics(vevent('same-uid', 'Team lunch', 2), vevent('other-uid', 'Team lunch', 2, '09'), vevent('o-only', 'Only Outlook', 4)));
    const g = (await add('Google', GOOGLE)).body.feed;
    await add('Outlook', OUTLOOK);
    const ev = (await me('GET', '/api/feeds/events')).body.events as { title: string; feedId: string }[];
    expect(ev.map((e) => e.title)).toEqual(['Team lunch', 'Only Google', 'Only Outlook']);
    expect(ev[0].feedId).toBe(g.id); // the first-connected calendar owns it
  });
});

describe('dedupeAcrossFeeds', () => {
  const e = (feedId: string, uid: string, title: string, start = '2026-06-10T09:00:00Z', end = '2026-06-10T10:00:00Z') => ({ feedId, uid, title, start, end });
  it('keeps both copies inside one feed, drops the repeat from a later feed', () => {
    const out = dedupeAcrossFeeds([e('1', 'a', 'Sync'), e('1', 'b', 'Sync'), e('2', 'a', 'Sync'), e('2', 'z', 'Sync')]);
    expect(out.map((x) => `${x.feedId}${x.uid}`)).toEqual(['1a', '1b']);
  });
  it('keeps same-titled meetings at different times', () => {
    expect(dedupeAcrossFeeds([e('1', 'a', 'Sync'), e('2', 'b', 'Sync', '2026-06-11T09:00:00Z', '2026-06-11T10:00:00Z')])).toHaveLength(2);
  });
});
