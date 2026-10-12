const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayStr = () => toDay(new Date());
export const isoToDay = (iso: string) => toDay(new Date(iso));

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
}
/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5);
}
/** Monday-based week start. */
export function startOfWeek(s: string): string {
  const d = parseDay(s);
  const dow = (d.getDay() + 6) % 7;
  return addDays(s, -dow);
}
export function daysRange(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}
/** 6x7 grid of days covering the month, starting Monday. */
export function monthGrid(year: number, month: number): string[] {
  const first = toDay(new Date(year, month, 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export function nowLocalInput(offsetMin = 0): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  return `${toDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localDateTime(s: string): Date {
  const [day, time = '00:00'] = s.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
export function dateTimeOf(date: string, time: string | null): Date {
  return localDateTime(`${date}T${time ?? '00:00'}`);
}
export function toLocalInput(d: Date): string {
  return `${toDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDay(s: string, long = false): string {
  return parseDay(s).toLocaleDateString(undefined, long
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric' });
}
export function relativeDay(s: string, today: string): string {
  const d = diffDays(today, s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days overdue`;
  if (d < 7) return parseDay(s).toLocaleDateString(undefined, { weekday: 'long' });
  return formatDay(s);
}
export function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
