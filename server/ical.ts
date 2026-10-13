import ICAL from 'ical.js';
import { isValidTimeZone, zonedToInstant } from './time';

/**
 * One concrete meeting occurrence from a feed. `start`/`end` are strings the browser can read directly:
 *  - "2026-06-10"            all-day (end is exclusive, as in iCalendar)
 *  - "2026-06-10T07:30:00Z"  a real instant (shown in the viewer's own time zone)
 *  - "2026-06-10T09:30:00"   floating wall-clock time with no zone (shown as-is)
 */
export interface Occurrence {
  uid: string;
  /** Stable identity inside its series (the ORIGINAL start), so a moved instance keeps the same key. */
  occ: string;
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
}

export interface ParseOptions {
  /** Occurrences ending before this (ms) are dropped. */
  from: number;
  /** Occurrences starting after this (ms) are dropped. */
  to: number;
  maxOccurrences?: number;
  maxIterationsPerSeries?: number;
}

export interface ParseResult { occurrences: Occurrence[]; warnings: string[]; truncated: boolean }

/** Windows zone names (Outlook) that have no VTIMEZONE block in the feed. Covers the common ones. */
const WINDOWS_ZONES: Record<string, string> = {
  'UTC': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul', 'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg', 'W. Central Africa Standard Time': 'Africa/Lagos',
  'Arab Standard Time': 'Asia/Riyadh', 'Arabian Standard Time': 'Asia/Dubai', 'Iran Standard Time': 'Asia/Tehran',
  'India Standard Time': 'Asia/Kolkata', 'Pakistan Standard Time': 'Asia/Karachi', 'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai', 'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'W. Australia Standard Time': 'Australia/Perth',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'E. Australia Standard Time': 'Australia/Brisbane', 'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'US Mountain Standard Time': 'America/Phoenix', 'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax', 'Canada Central Standard Time': 'America/Regina',
  'Mexico Standard Time': 'America/Mexico_City', 'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires', 'Morocco Standard Time': 'Africa/Casablanca', 'Tunisia Standard Time': 'Africa/Tunis',
};

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const p2 = (n: number) => String(n).padStart(2, '0');

/** Resolve a TZID that has no VTIMEZONE block: IANA name, Windows name, or unknown (null). */
function zoneName(tzid: string | null): string | null {
  if (!tzid) return null;
  const bare = tzid.replace(/^\//, '');
  if (isValidTimeZone(bare)) return bare;
  const win = WINDOWS_ZONES[tzid];
  return win && isValidTimeZone(win) ? win : null;
}

/** Serialise an iCalendar time as described on {@link Occurrence}. `tzid` is the TZID parameter of the source property, if any. */
function stamp(t: ICAL.Time, tzid: string | null, warn: (m: string) => void): string {
  if (t.isDate) return `${t.year}-${p2(t.month)}-${p2(t.day)}`;
  const zone = t.zone?.tzid;
  if (zone && zone !== 'floating') return t.toJSDate().toISOString().replace('.000Z', 'Z'); // UTC or a VTIMEZONE-backed zone
  const wall = `${t.year}-${p2(t.month)}-${p2(t.day)}T${p2(t.hour)}:${p2(t.minute)}:${p2(t.second)}`;
  if (tzid) {
    const name = zoneName(tzid);
    if (name) {
      const ms = zonedToInstant(wall, name);
      if (ms !== null) return new Date(ms).toISOString().replace('.000Z', 'Z');
    }
    warn(`Unknown time zone "${tzid.slice(0, 60)}": shown at the listed clock time.`);
  }
  return wall;
}

/** Milliseconds for ordering/windowing. Floating and all-day values are read as UTC (a few hours of slack is fine). */
export const approxMs = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s.endsWith('Z') ? s : `${s}Z`);

const tzidOf = (c: ICAL.Component, name: string) => {
  const v = c.getFirstProperty(name)?.getParameter('tzid');
  return typeof v === 'string' ? v : null;
};
const num = (c: ICAL.Component, name: string) => Number(c.getFirstPropertyValue(name) ?? 0) || 0;
const modified = (c: ICAL.Component) => {
  const v = c.getFirstPropertyValue('last-modified') ?? c.getFirstPropertyValue('dtstamp');
  return v instanceof ICAL.Time ? v.toUnixTime() : 0;
};
const status = (c: ICAL.Component) => String(c.getFirstPropertyValue('status') ?? '').toUpperCase();

/** When a feed lists the same UID/instance twice (Google does after edits) the newest SEQUENCE / modification wins. */
function newest(list: ICAL.Component[]): ICAL.Component {
  return list.reduce((a, b) => (num(b, 'sequence') - num(a, 'sequence') || modified(b) - modified(a)) > 0 ? b : a);
}

export function parseIcs(text: string, opts: ParseOptions): ParseResult {
  const max = opts.maxOccurrences ?? 5000;
  const maxIter = opts.maxIterationsPerSeries ?? 20000;
  const warnings = new Set<string>();
  const warn = (m: string) => { if (warnings.size < 10) warnings.add(m); };
  const out: Occurrence[] = [];
  let truncated = false;

  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== 'vcalendar') throw new Error('Not a calendar');

  // Register this feed's own VTIMEZONE blocks (Outlook uses Windows zone names). Parsing is synchronous, so nothing can interleave.
  ICAL.TimezoneService.reset();
  try {
    for (const tz of root.getAllSubcomponents('vtimezone')) {
      try { ICAL.TimezoneService.register(tz); } catch { warn('A time zone definition could not be read.'); }
    }

    type Group = { masters: ICAL.Component[]; overrides: Map<string, ICAL.Component[]> };
    const byUid = new Map<string, Group>();
    for (const v of root.getAllSubcomponents('vevent')) {
      const uid = clip(v.getFirstPropertyValue('uid'), 500);
      if (!uid || !v.hasProperty('dtstart')) continue;
      const g: Group = byUid.get(uid) ?? { masters: [], overrides: new Map() };
      byUid.set(uid, g);
      const rid = v.getFirstProperty('recurrence-id');
      if (!rid) { g.masters.push(v); continue; }
      const rt = rid.getFirstValue() as ICAL.Time;
      const key = stamp(rt, tzidOf(v, 'recurrence-id'), warn);
      g.overrides.set(key, [...(g.overrides.get(key) ?? []), v]);
    }

    const inWindow = (start: string, end: string) => approxMs(end) >= opts.from && approxMs(start) <= opts.to;
    const push = (o: Occurrence) => {
      if (out.length >= max) { truncated = true; return; }
      out.push(o);
    };

    const make = (uid: string, occ: string, evt: ICAL.Event, start: ICAL.Time, end: ICAL.Time, comp: ICAL.Component) => {
      const startTz = tzidOf(comp, 'dtstart');
      const allDay = start.isDate;
      const s = stamp(start, startTz, warn);
      let e = stamp(end, tzidOf(comp, 'dtend') ?? startTz, warn);
      if (approxMs(e) <= approxMs(s)) {
        // missing/invalid end: all-day lasts one day, timed events are instantaneous markers
        e = allDay ? stamp(start.clone().adjust(1, 0, 0, 0), null, warn) : s;
      }
      if (!inWindow(s, e)) return;
      push({
        uid, occ, allDay, start: s, end: e,
        title: clip(evt.summary, 300) || '(No title)',
        location: clip(evt.location, 300),
        description: clip(evt.description, 2000),
      });
    };

    for (const [uid, g] of byUid) {
      const masterComp = g.masters.length ? newest(g.masters) : null;
      const overrides = new Map([...g.overrides].map(([k, list]) => [k, newest(list)]));

      if (!masterComp) {
        // an invitation to a single instance of a series we cannot see: show those instances as plain meetings
        for (const [key, comp] of overrides) {
          if (status(comp) === 'CANCELLED') continue;
          const evt = new ICAL.Event(comp);
          make(uid, key, evt, evt.startDate, evt.endDate, comp);
        }
        continue;
      }
      if (status(masterComp) === 'CANCELLED') continue;

      const evt = new ICAL.Event(masterComp);
      if (!evt.isRecurring()) {
        make(uid, 'single', evt, evt.startDate, evt.endDate, masterComp);
        continue;
      }

      for (const comp of overrides.values()) evt.relateException(new ICAL.Event(comp));
      const iter = evt.iterator();
      let n = 0;
      for (let t = iter.next(); t; t = iter.next()) {
        if (++n > maxIter) { warn('A repeating meeting has too many occurrences; later ones were skipped.'); break; }
        const details = evt.getOccurrenceDetails(t);
        const comp = details.item.component;
        const key = stamp(t, tzidOf(masterComp, 'dtstart'), warn);
        // the series is past the window once even its original, unmoved start is: stop iterating
        // far enough past the window that even a moved instance is unlikely to come back into it
        if (approxMs(key) > opts.to + 400 * 86400_000) break;
        if (status(comp) === 'CANCELLED') continue; // a cancelled single instance
        make(uid, key, details.item, details.startDate, details.endDate, comp);
        if (truncated) break;
      }
    }
  } finally {
    ICAL.TimezoneService.reset();
  }

  // identical (uid, instance) can only appear once
  const seen = new Set<string>();
  const unique = out.filter((o) => { const k = `${o.uid}\u0000${o.occ}`; if (seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a, b) => approxMs(a.start) - approxMs(b.start) || a.title.localeCompare(b.title));
  return { occurrences: unique, warnings: [...warnings], truncated };
}
