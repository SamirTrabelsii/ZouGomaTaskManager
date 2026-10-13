import { describe, expect, it } from 'vitest';
import { parseIcs } from './ical';

const FROM = Date.UTC(2026, 0, 1);
const TO = Date.UTC(2027, 0, 1);
const parse = (body: string, extra: object = {}) => parseIcs(cal(body), { from: FROM, to: TO, ...extra });
const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body.trim().replace(/\n/g, '\r\n')}\r\nEND:VCALENDAR\r\n`;
const ev = (lines: string) => `BEGIN:VEVENT\n${lines.trim()}\nEND:VEVENT\n`;

/** Outlook publishes Windows zone names together with a VTIMEZONE block that carries the DST rules. */
const WEU = `BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE
`;

describe('time zones', () => {
  it('keeps UTC times as real instants', () => {
    const r = parse(ev('UID:u1\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:Sync'));
    expect(r.occurrences).toEqual([expect.objectContaining({ title: 'Sync', start: '2026-06-10T07:30:00Z', end: '2026-06-10T08:30:00Z', allDay: false })]);
  });

  it('reads Google-style IANA zones (summer and winter offsets differ)', () => {
    const r = parse(
      ev('UID:s\nDTSTART;TZID=Europe/Paris:20260610T093000\nDTEND;TZID=Europe/Paris:20260610T103000\nSUMMARY:Summer') +
      ev('UID:w\nDTSTART;TZID=Europe/Paris:20261210T093000\nDTEND;TZID=Europe/Paris:20261210T103000\nSUMMARY:Winter') +
      ev('UID:n\nDTSTART;TZID=America/New_York:20260610T093000\nDTEND;TZID=America/New_York:20260610T103000\nSUMMARY:NY'));
    const by = Object.fromEntries(r.occurrences.map((o) => [o.title, o.start]));
    expect(by.Summer).toBe('2026-06-10T07:30:00Z');
    expect(by.Winter).toBe('2026-12-10T08:30:00Z');
    expect(by.NY).toBe('2026-06-10T13:30:00Z');
  });

  it('reads Outlook Windows zones with a VTIMEZONE block', () => {
    const r = parse(WEU + ev('UID:o\nDTSTART;TZID=W. Europe Standard Time:20260610T093000\nDTEND;TZID=W. Europe Standard Time:20260610T103000\nSUMMARY:Outlook'));
    expect(r.occurrences[0].start).toBe('2026-06-10T07:30:00Z');
    expect(r.warnings).toEqual([]);
  });

  it('maps a Windows zone name even when the feed omits the VTIMEZONE block', () => {
    const r = parse(ev('UID:o\nDTSTART;TZID=Romance Standard Time:20261210T093000\nDTEND;TZID=Romance Standard Time:20261210T103000\nSUMMARY:Paris'));
    expect(r.occurrences[0].start).toBe('2026-12-10T08:30:00Z');
  });

  it('shows an unknown zone at its clock time and warns instead of guessing', () => {
    const r = parse(ev('UID:x\nDTSTART;TZID=Mars/Olympus:20260610T093000\nDTEND;TZID=Mars/Olympus:20260610T103000\nSUMMARY:Odd'));
    expect(r.occurrences[0].start).toBe('2026-06-10T09:30:00');
    expect(r.warnings.join(' ')).toMatch(/Mars\/Olympus/);
  });

  it('keeps floating times as wall-clock', () => {
    const r = parse(ev('UID:f\nDTSTART:20260610T093000\nDTEND:20260610T103000\nSUMMARY:Float'));
    expect(r.occurrences[0]).toMatchObject({ start: '2026-06-10T09:30:00', end: '2026-06-10T10:30:00' });
  });

  it('does not leak one feed\'s zone definition into the next parse', () => {
    const shifted = WEU.replace('TZOFFSETTO:+0200', 'TZOFFSETTO:+0300'); // a (wrong) feed redefining the same TZID
    const body = ev('UID:o\nDTSTART;TZID=W. Europe Standard Time:20260610T093000\nDTEND;TZID=W. Europe Standard Time:20260610T103000\nSUMMARY:A');
    expect(parse(shifted + body).occurrences[0].start).not.toBe('2026-06-10T07:30:00Z');
    expect(parse(WEU + body).occurrences[0].start).toBe('2026-06-10T07:30:00Z');
  });
});

describe('all-day meetings', () => {
  it('uses an exclusive end date, like iCalendar', () => {
    const r = parse(ev('UID:a\nDTSTART;VALUE=DATE:20260610\nDTEND;VALUE=DATE:20260613\nSUMMARY:Conference'));
    expect(r.occurrences[0]).toMatchObject({ allDay: true, start: '2026-06-10', end: '2026-06-13' });
  });
  it('lasts one day when there is no end', () => {
    const r = parse(ev('UID:a\nDTSTART;VALUE=DATE:20260610\nSUMMARY:Holiday'));
    expect(r.occurrences[0]).toMatchObject({ allDay: true, start: '2026-06-10', end: '2026-06-11' });
  });
});

describe('recurring meetings', () => {
  const series = (extra: string) => WEU + ev(`UID:s1
DTSTART;TZID=W. Europe Standard Time:20261012T090000
DTEND;TZID=W. Europe Standard Time:20261012T100000
RRULE:FREQ=WEEKLY;COUNT=5
SUMMARY:Standup
${extra}`);

  it('expands a weekly series and keeps 09:00 local across the autumn clock change', () => {
    const r = parse(series(''));
    // Oct 12 and 19 are summer time (UTC+2); the clocks go back on Oct 25, so Oct 26 onwards is UTC+1
    expect(r.occurrences.map((o) => o.start)).toEqual([
      '2026-10-12T07:00:00Z', '2026-10-19T07:00:00Z', '2026-10-26T08:00:00Z', '2026-11-02T08:00:00Z', '2026-11-09T08:00:00Z',
    ]);
  });

  it('drops EXDATE occurrences', () => {
    const r = parse(series('EXDATE;TZID=W. Europe Standard Time:20261019T090000'));
    expect(r.occurrences.map((o) => o.start.slice(0, 10))).toEqual(['2026-10-12', '2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('shows a moved occurrence only at its new time', () => {
    const moved = ev(`UID:s1
RECURRENCE-ID;TZID=W. Europe Standard Time:20261019T090000
DTSTART;TZID=W. Europe Standard Time:20261019T140000
DTEND;TZID=W. Europe Standard Time:20261019T150000
SUMMARY:Standup (moved)`);
    const r = parse(series('') + moved);
    expect(r.occurrences).toHaveLength(5);
    const m = r.occurrences.find((o) => o.title === 'Standup (moved)')!;
    expect(m.start).toBe('2026-10-19T12:00:00Z');
    expect(m.occ).toBe('2026-10-19T07:00:00Z'); // identity stays that of the original slot
    expect(r.occurrences.filter((o) => o.start.startsWith('2026-10-19T07'))).toEqual([]);
  });

  it('hides a cancelled occurrence', () => {
    const cancelled = ev(`UID:s1
RECURRENCE-ID;TZID=W. Europe Standard Time:20261102T090000
STATUS:CANCELLED
DTSTART;TZID=W. Europe Standard Time:20261102T090000
SUMMARY:Standup`);
    const r = parse(series('') + cancelled);
    expect(r.occurrences.map((o) => o.start.slice(0, 10))).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-09']);
  });

  it('skips a wholly cancelled meeting, single or recurring', () => {
    expect(parse(ev('UID:c\nSTATUS:CANCELLED\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:Gone')).occurrences).toEqual([]);
    expect(parse(series('STATUS:CANCELLED')).occurrences).toEqual([]);
  });

  it('bounds an endless series to the window', () => {
    const r = parse(ev('UID:e\nDTSTART:20250101T080000Z\nDTEND:20250101T083000Z\nRRULE:FREQ=DAILY\nSUMMARY:Daily'));
    expect(r.occurrences.length).toBe(365); // all of 2026
    expect(r.occurrences[0].start).toBe('2026-01-01T08:00:00Z');
  });

  it('reports truncation instead of silently dropping meetings', () => {
    const r = parse(ev('UID:e\nDTSTART:20260101T080000Z\nDTEND:20260101T083000Z\nRRULE:FREQ=DAILY\nSUMMARY:Daily'), { maxOccurrences: 10 });
    expect(r.occurrences).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('shows a single invited instance whose series is not in the feed', () => {
    const r = parse(ev(`UID:orphan
RECURRENCE-ID:20260610T073000Z
DTSTART:20260610T080000Z
DTEND:20260610T090000Z
SUMMARY:Just this one`));
    expect(r.occurrences).toEqual([expect.objectContaining({ title: 'Just this one', start: '2026-06-10T08:00:00Z' })]);
  });
});

describe('duplicates and bad input', () => {
  it('keeps only the newest version when a UID is listed twice', () => {
    const r = parse(
      ev('UID:d\nSEQUENCE:0\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:Old') +
      ev('UID:d\nSEQUENCE:2\nDTSTART:20260611T073000Z\nDTEND:20260611T083000Z\nSUMMARY:New') +
      ev('UID:d\nSEQUENCE:1\nDTSTART:20260612T073000Z\nDTEND:20260612T083000Z\nSUMMARY:Middle'));
    expect(r.occurrences).toEqual([expect.objectContaining({ title: 'New', start: '2026-06-11T07:30:00Z' })]);
  });

  it('keeps distinct meetings that share a title and time but not a UID', () => {
    const e = (uid: string) => ev(`UID:${uid}\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:Same`);
    expect(parse(e('1') + e('2')).occurrences).toHaveLength(2);
  });

  it('drops meetings outside the window', () => {
    const r = parse(ev('UID:old\nDTSTART:20240610T073000Z\nDTEND:20240610T083000Z\nSUMMARY:Old') + ev('UID:in\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:In'));
    expect(r.occurrences.map((o) => o.title)).toEqual(['In']);
  });

  it('gives untitled meetings a title and trims long text', () => {
    const r = parse(ev(`UID:t\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nDESCRIPTION:${'x'.repeat(5000)}`));
    expect(r.occurrences[0].title).toBe('(No title)');
    expect(r.occurrences[0].description.length).toBe(2000);
  });

  it('unescapes iCalendar text', () => {
    const r = parse(ev('UID:t\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:Plan\\, review\\; ship\nLOCATION:Room 1\\nFloor 2'));
    expect(r.occurrences[0]).toMatchObject({ title: 'Plan, review; ship', location: 'Room 1\nFloor 2' });
  });

  it('rejects text that is not a calendar', () => {
    expect(() => parseIcs('<html>hello</html>', { from: FROM, to: TO })).toThrow();
  });

  it('survives events without a start or UID', () => {
    const r = parse(ev('UID:nostart\nSUMMARY:x') + ev('DTSTART:20260610T073000Z\nSUMMARY:nouid') + ev('UID:ok\nDTSTART:20260610T073000Z\nDTEND:20260610T083000Z\nSUMMARY:ok'));
    expect(r.occurrences.map((o) => o.title)).toEqual(['ok']);
  });
});
