/**
 * Absences: the days, how they are worded in French, and the mails that announce them.
 * Pure code with no Node imports, so the browser shows exactly the text the server hands to the executor (n8n).
 * Recipients are not here (this repository is public): they live in the owner's absence settings.
 */

export type DayPart = 'full' | 'am' | 'pm';
export interface AbsenceDay { date: string; part: DayPart }
export interface Recipients { to: string[]; cc: string[] }
export interface AbsenceSettings {
  /** The mail to the employer (Olivesoft), sent from Outlook. */
  employer: Recipients;
  /** The mail to the client (Skill and You), sent from the client Gmail. */
  client: Recipients;
  /** The owner's name exactly as written in the team planning workbook. */
  planningName: string;
}
export const EMPTY_SETTINGS: AbsenceSettings = { employer: { to: [], cc: [] }, client: { to: [], cc: [] }, planningName: '' };

export const DAY_PARTS: readonly DayPart[] = ['full', 'am', 'pm'];

/** What an absence sets off, in the order it is shown. Each step is run by whichever executor knows it (n8n, the local agent). */
export const ABSENCE_STEPS = ['mail_employer', 'mail_client', 'planning', 'outlook_status', 'google_status', 'boond_absence', 'boond_cra'] as const;
export type AbsenceStep = (typeof ABSENCE_STEPS)[number];
export const STEP_LABELS: Record<AbsenceStep, string> = {
  mail_employer: 'Mail to Olivesoft (Outlook)',
  mail_client: 'Mail to Skill and You (Gmail)',
  planning: 'Team planning (Excel)',
  outlook_status: 'Out of office in Outlook and Teams',
  google_status: 'Out of office in Gmail and Google Chat',
  boond_absence: 'Absence request in Boond',
  boond_cra: 'Timesheet (CRA) in Boond',
};
export const STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const MAX_ABSENCE_DAYS = 60;

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_MS = 86_400_000;

/** "2026-11-06" as a UTC midnight timestamp, or null if it is not a real calendar day. */
export function dayValue(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}
const weekday = (t: number) => new Date(t).getUTCDay();
export const isWeekend = (date: string) => { const t = dayValue(date); return t !== null && (weekday(t) === 0 || weekday(t) === 6); };

/** Checks and sorts a list of days. Returns the clean list or a message for the owner. */
export function cleanDays(input: unknown): AbsenceDay[] | string {
  if (!Array.isArray(input) || input.length === 0) return 'Pick at least one day.';
  if (input.length > MAX_ABSENCE_DAYS) return `At most ${MAX_ABSENCE_DAYS} days at once.`;
  const seen = new Set<string>();
  const out: AbsenceDay[] = [];
  for (const raw of input) {
    const d = raw as Partial<AbsenceDay> | null;
    if (!d || typeof d.date !== 'string' || dayValue(d.date) === null) return 'One of the dates is not a real day.';
    if (!DAY_PARTS.includes(d.part as DayPart)) return 'Each day is a whole day, a morning or an afternoon.';
    if (seen.has(d.date)) return `${d.date} is picked twice.`;
    seen.add(d.date);
    out.push({ date: d.date, part: d.part as DayPart });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayName = (t: number) => `${DAYS[weekday(t)]} ${pad(new Date(t).getUTCDate())}`;
const dayMonth = (t: number) => `${dayName(t)} ${MONTHS[new Date(t).getUTCMonth()]}`;
const full = (t: number) => `${dayMonth(t)} ${new Date(t).getUTCFullYear()}`;
const sameMonth = (a: number, b: number) => new Date(a).getUTCMonth() === new Date(b).getUTCMonth() && new Date(a).getUTCFullYear() === new Date(b).getUTCFullYear();
const sameYear = (a: number, b: number) => new Date(a).getUTCFullYear() === new Date(b).getUTCFullYear();

/** The next working day (Monday after a Friday). */
const nextWorkday = (t: number) => { let n = t + DAY_MS; while (weekday(n) === 0 || weekday(n) === 6) n += DAY_MS; return n; };

/** Whole days that follow each other (over a weekend too) form one stretch; a half day always stands alone. */
interface Stretch { from: number; to: number; part: DayPart }
function stretches(days: AbsenceDay[]): Stretch[] {
  const out: Stretch[] = [];
  for (const d of days) {
    const t = dayValue(d.date)!;
    const last = out[out.length - 1];
    if (last && d.part === 'full' && last.part === 'full' && nextWorkday(last.to) === t) last.to = t;
    else out.push({ from: t, to: t, part: d.part });
  }
  return out;
}

function stretchText(s: Stretch): string {
  if (s.from === s.to) return `le ${full(s.from)}${s.part === 'am' ? ' matin' : s.part === 'pm' ? ' après-midi' : ''}`;
  if (!sameYear(s.from, s.to)) return `du ${full(s.from)} au ${full(s.to)}`;
  if (!sameMonth(s.from, s.to)) return `du ${dayMonth(s.from)} au ${full(s.to)}`;
  return `du ${dayName(s.from)} au ${full(s.to)}`;
}

const joinFr = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`);

/**
 * "le vendredi 06 novembre 2026", "le jeudi 19 novembre 2026 après-midi", "du lundi 09 au mercredi 11 novembre 2026",
 * "les lundi 09, mercredi 11 et vendredi 13 novembre 2026", or several of these joined with "et".
 */
export function describeDays(days: AbsenceDay[]): string {
  const list = stretches(days);
  const single = list.every((s) => s.from === s.to && s.part === 'full');
  if (list.length > 1 && single && sameYear(list[0].from, list[list.length - 1].from)) {
    // "les lundi 09 et mardi 10 novembre 2026", "les vendredi 27 novembre et mardi 01 décembre 2026"
    const words = list.map((s, i) => {
      const next = list[i + 1];
      return next && sameMonth(s.from, next.from) ? dayName(s.from) : dayMonth(s.from);
    });
    return `les ${joinFr(words)} ${new Date(list[0].from).getUTCFullYear()}`;
  }
  return joinFr(list.map(stretchText));
}

/** Total in days, half days counting one half. */
export function dayCount(days: AbsenceDay[]): number {
  return days.reduce((n, d) => n + (d.part === 'full' ? 1 : 0.5), 0);
}

/**
 * When the owner is away, as wall-clock times (no time zone: the executor applies the owner's own).
 * A morning ends at 13:00 and an afternoon starts there; whole days that follow each other, weekends included, make one window.
 */
export function awayWindows(days: AbsenceDay[]): { start: string; end: string }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of stretches(days)) {
    const start = s.from + (s.part === 'pm' ? 13 * 3_600_000 : 0);
    const end = s.part === 'am' ? s.to + 13 * 3_600_000 : s.to + DAY_MS;
    const last = out[out.length - 1];
    // windows that touch merge, and so do two separated by nothing but a whole weekend (away Friday afternoon and Monday)
    const onlyWeekendBetween = last && weekday(last.end) === 6 && last.end % DAY_MS === 0 && start === last.end + 2 * DAY_MS;
    if (last && (start === last.end || onlyWeekendBetween)) last.end = end;
    else out.push({ start, end });
  }
  const text = (t: number) => new Date(t).toISOString().slice(0, 16);
  return out.map((w) => ({ start: text(w.start), end: text(w.end) }));
}

export interface AbsenceMail {
  key: 'employer' | 'client';
  label: string;
  /** Which mailbox sends it. */
  via: 'outlook' | 'gmail';
  to: string[];
  cc: string[];
  subject: string;
  /** One entry per line; an empty one is a blank line. */
  lines: string[];
}

/** The two mails, worded as the owner writes them. Only the period changes. */
export function absenceMails(days: AbsenceDay[], settings: AbsenceSettings): AbsenceMail[] {
  const when = describeDays(days);
  return [
    {
      key: 'employer', label: 'Olivesoft', via: 'outlook', ...settings.employer, subject: 'Absence du bureau',
      lines: [
        'Bonjour,',
        'J\'espère que tu vas bien.',
        `Je voulais t'informer que je serai absent du bureau ${when}.`,
        'Je te remercie par avance de bien vouloir prendre en compte ma demande.',
        'Cordialement,',
      ],
    },
    {
      key: 'client', label: 'Skill and You', via: 'gmail', ...settings.client, subject: 'Absence du bureau',
      lines: ['Bonjour,', '', 'J’espère que tu vas bien.', '', `Je souhaite t’informer que je serai absent du bureau ${when}.`, '', 'Cordialement,'],
    },
  ];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The body as simple HTML paragraphs, for the executor to put above the signature. */
export function mailHtml(mail: AbsenceMail): string {
  return mail.lines.map((l) => (l ? `<div>${escapeHtml(l)}</div>` : '<div><br></div>')).join('');
}

/** What the planning workbook gets for each day: only whole days are written, a half day keeps the day's usual status. */
export function planningCells(days: AbsenceDay[]): { date: string; value: 'Absent' }[] {
  return days.filter((d) => d.part === 'full' && !isWeekend(d.date)).map((d) => ({ date: d.date, value: 'Absent' as const }));
}
