/**
 * API for the e2e suite only: the real app, but calendar feeds are served from fixtures instead of the internet
 * (the production fetcher rightly refuses local addresses, so it could not read a local fixture server).
 */
import { assertTestDatabase, TEST_DATABASE_URL } from './testdb';
import { createApp } from '../server/app';
import { createPool, migrate } from '../server/db';
import { FeedError, type FeedFetcher } from '../server/feedFetch';

assertTestDatabase(process.env.DATABASE_URL ?? TEST_DATABASE_URL);

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const compact = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const ymd = compact(now);
const nextYmd = compact(new Date(now.getTime() + 86400_000));

/** Wall-clock text of an instant in Europe/Paris, e.g. 20260610T100000 */
const paris = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    ).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
};
const iso = (hhmm: string) => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T${hhmm}:00Z`;

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//e2e//EN\r\n${body}END:VCALENDAR\r\n`;

const FIXTURES: Record<string, string> = {
  // Google style: UTC instants
  '/google.ics': wrap(
    `BEGIN:VEVENT\r\nUID:g1@e2e\r\nDTSTART:${ymd}T120000Z\r\nDTEND:${ymd}T130000Z\r\nSUMMARY:Team sync\r\nLOCATION:Room 4\r\nDESCRIPTION:Weekly catch-up\r\nEND:VEVENT\r\n` +
    // the same meeting also appears in the Outlook calendar below: it must be shown once
    `BEGIN:VEVENT\r\nUID:shared@e2e\r\nDTSTART:${ymd}T140000Z\r\nDTEND:${ymd}T150000Z\r\nSUMMARY:Shared lunch\r\nEND:VEVENT\r\n`),
  // Outlook style: Windows zone name + VTIMEZONE block, plus an all-day entry
  '/outlook.ics': wrap(
    `BEGIN:VTIMEZONE\r\nTZID:W. Europe Standard Time\r\nBEGIN:STANDARD\r\nDTSTART:16010101T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10\r\nEND:STANDARD\r\n` +
    `BEGIN:DAYLIGHT\r\nDTSTART:16010101T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\n` +
    `BEGIN:VEVENT\r\nUID:o1@e2e\r\nDTSTART;TZID=W. Europe Standard Time:${paris(iso('08:00'))}\r\nDTEND;TZID=W. Europe Standard Time:${paris(iso('09:00'))}\r\nSUMMARY:Budget review\r\nEND:VEVENT\r\n` +
    `BEGIN:VEVENT\r\nUID:o2@e2e\r\nDTSTART;VALUE=DATE:${ymd}\r\nDTEND;VALUE=DATE:${nextYmd}\r\nSUMMARY:Company day\r\nEND:VEVENT\r\n` +
    `BEGIN:VEVENT\r\nUID:shared@e2e\r\nDTSTART:${ymd}T140000Z\r\nDTEND:${ymd}T150000Z\r\nSUMMARY:Shared lunch\r\nEND:VEVENT\r\n`),
};

const fetchFeed: FeedFetcher = async (raw) => {
  const u = new URL(raw);
  if (u.hostname !== 'feeds.test') throw new FeedError('The calendar server could not be reached.');
  const body = FIXTURES[u.pathname];
  if (!body) throw new FeedError('The calendar link does not exist (anymore). Copy the secret address again.');
  return body;
};

const pool = createPool();
await migrate(pool);
const app = createApp({ pool, secureCookies: false, allowRegistration: false, fetchFeed });
const port = Number(process.env.PORT ?? 3101);
app.listen(port, () => console.log(`LifeOS e2e API listening on http://localhost:${port}`));
