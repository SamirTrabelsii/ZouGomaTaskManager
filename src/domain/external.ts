import type { CalendarFeed, ExternalEvent } from './types';
import type { AgendaItem } from './services';
import { addDays, toDay } from './dates';

const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
/** Longest span (in days) we lay out day by day; protects the month view from absurd feeds. */
const MAX_SPAN_DAYS = 31;

/** Local day/time of an imported meeting: instants are converted to this device's zone, floating times are taken as written. */
export function localSpan(e: Pick<ExternalEvent, 'allDay' | 'start' | 'end'>) {
  if (e.allDay) {
    const last = e.end > e.start ? addDays(e.end, -1) : e.start; // iCalendar all-day ends are exclusive
    return { startDay: e.start, lastDay: last < e.start ? e.start : last, startTime: null as string | null, endTime: null as string | null };
  }
  const s = new Date(e.start), t = new Date(e.end);
  if (Number.isNaN(s.getTime())) return null;
  const endOk = !Number.isNaN(t.getTime()) && t.getTime() > s.getTime();
  const e2 = endOk ? t : s;
  const startDay = toDay(s);
  // a meeting ending exactly at midnight does not spill into the next day
  let lastDay = toDay(endOk && e2.getHours() === 0 && e2.getMinutes() === 0 ? new Date(e2.getTime() - 1) : e2);
  if (lastDay < startDay) lastDay = startDay;
  return { startDay, lastDay, startTime: hhmm(s), endTime: endOk ? hhmm(e2) : null };
}

/** One agenda item per day a meeting touches, in this device's local time, coloured by its calendar. */
export function externalAgendaItems(events: ExternalEvent[], feeds: CalendarFeed[]): AgendaItem[] {
  const byFeed = new Map(feeds.map((f) => [f.id, f]));
  const out: AgendaItem[] = [];
  for (const e of events) {
    const feed = byFeed.get(e.feedId);
    if (!feed) continue; // calendar was removed since this list was loaded
    const span = localSpan(e);
    if (!span) continue;
    let day = span.startDay;
    for (let i = 0; i < MAX_SPAN_DAYS && day <= span.lastDay; i++, day = addDays(day, 1)) {
      out.push({
        key: `x${e.id}@${day}`, kind: 'external', date: day, time: i === 0 ? span.startTime : null,
        title: e.title, refId: e.id, color: feed.color, feedName: feed.name,
      });
    }
  }
  return out;
}

/** "9:30 AM – 10:30 AM" style detail line for the read-only dialog. */
export function describeWhen(e: ExternalEvent, fmtDay: (d: string) => string, fmtTime: (t: string | null) => string): string {
  const s = localSpan(e);
  if (!s) return '';
  if (e.allDay) return s.lastDay > s.startDay ? `${fmtDay(s.startDay)} – ${fmtDay(s.lastDay)} · all day` : `${fmtDay(s.startDay)} · all day`;
  const when = s.lastDay > s.startDay
    ? `${fmtDay(s.startDay)} ${fmtTime(s.startTime)} → ${fmtDay(s.lastDay)} ${fmtTime(s.endTime)}`
    : `${fmtDay(s.startDay)} · ${fmtTime(s.startTime)}${s.endTime && s.endTime !== s.startTime ? ` – ${fmtTime(s.endTime)}` : ''}`;
  return when;
}
