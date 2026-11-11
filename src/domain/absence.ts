/**
 * Absences on the client: the wording and mails come from the server's own module, so the preview is exactly what is sent.
 * This file adds what only the room and the panel need: picking days in a month grid, and the robot's mood.
 */
import { dayValue, isWeekend, type AbsenceDay, type AbsenceStep, type DayPart, type StepStatus } from '../../server/absenceText';

export {
  ABSENCE_STEPS, ABSENCE_TYPES, STEP_LABELS, absenceMails, dayCount, describeDays, isWeekend, EMPTY_SETTINGS,
  type AbsenceDay, type AbsenceSettings, type AbsenceType, type AbsenceStep, type DayPart, type Recipients, type StepStatus, type AbsenceMail,
} from '../../server/absenceText';

export interface AbsenceStepState { id: string; kind: AbsenceStep; status: StepStatus; detail: string; finishedAt: string | null }
export interface Absence { id: string; days: AbsenceDay[]; label: string; cancelled: boolean; createdAt: string; steps: AbsenceStepState[] }
export interface AbsenceExecutor { lastSeenAt: string | null; online: boolean; kinds: AbsenceStep[] }
/** One executor (one agent token: n8n, the local agent…). */
export interface AbsencePoller extends AbsenceExecutor { name: string }
export interface AbsenceList { absences: Absence[]; executor: AbsenceExecutor; executors: AbsencePoller[] }

/** The steps ticked by default: the ones an executor already runs, else everything but Boond (not automated yet). */
export function defaultSteps(executor: AbsenceExecutor | null): AbsenceStep[] {
  if (executor?.kinds.length) return executor.kinds;
  return ['mail_employer', 'mail_client', 'planning', 'outlook_status', 'google_status'];
}

/* ── picking days ── */

/** One click on a day: whole day → morning → afternoon → not away. */
export function cycleDay(days: AbsenceDay[], date: string): AbsenceDay[] {
  const cur = days.find((d) => d.date === date);
  const next: Record<DayPart, DayPart | null> = { full: 'am', am: 'pm', pm: null };
  const part = cur ? next[cur.part] : 'full';
  const rest = days.filter((d) => d.date !== date);
  return (part ? [...rest, { date, part }] : rest).sort((a, b) => a.date.localeCompare(b.date));
}

const DAY_MS = 86_400_000;
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Every weekday between two dates (either order) as a whole day, added to what is already picked. */
export function addRange(days: AbsenceDay[], a: string, b: string): AbsenceDay[] {
  let from = dayValue(a), to = dayValue(b);
  if (from === null || to === null) return days;
  if (to < from) [from, to] = [to, from];
  const picked = new Map(days.map((d) => [d.date, d]));
  for (let t = from; t <= to; t += DAY_MS) {
    const date = isoOf(t);
    if (!isWeekend(date)) picked.set(date, { date, part: 'full' });
  }
  return [...picked.values()].sort((x, y) => x.date.localeCompare(y.date));
}

/** The weeks of a month for a Monday-first grid: null for the blanks before the 1st and after the last day. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = Date.UTC(year, month, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday = 0
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let i = 0; i < count; i++) cells.push(isoOf(first + i * DAY_MS));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/* ── the robot ── */

/** Days of live (not cancelled) absences from `today` on, soonest first. */
export function upcomingDays(absences: Absence[], today: string): AbsenceDay[] {
  return absences.filter((a) => !a.cancelled).flatMap((a) => a.days).filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

export type AbsenceBotMood =
  /** a step failed: it needs the owner */
  | 'worried'
  /** steps are running, or waiting with an executor listening */
  | 'busy'
  /** steps wait but no executor has polled lately (the PC is off) */
  | 'waiting'
  /** the owner is away today */
  | 'away'
  | 'idle';

export function absenceBotMood(list: AbsenceList | null, today: string): AbsenceBotMood {
  if (!list) return 'idle';
  const live = list.absences.filter((a) => !a.cancelled);
  const steps = live.flatMap((a) => a.steps);
  if (steps.some((s) => s.status === 'failed')) return 'worried';
  const open = steps.filter((s) => s.status === 'pending' || s.status === 'running');
  if (open.some((s) => s.status === 'running') || (open.length && list.executor.online)) return 'busy';
  if (open.length) return 'waiting';
  if (live.some((a) => a.days.some((d) => d.date === today))) return 'away';
  return 'idle';
}

/** Hover card text for the room. */
export function absenceSummary(list: AbsenceList | null, today: string): { summary: string; prompt: string | null } {
  if (!list) return { summary: 'Absences', prompt: null };
  const mood = absenceBotMood(list, today);
  const failed = list.absences.flatMap((a) => a.steps).filter((s) => s.status === 'failed').length;
  if (mood === 'worried') return { summary: `${failed} action${failed === 1 ? '' : 's'} failed`, prompt: 'Open to retry' };
  if (mood === 'waiting') return { summary: 'Waiting for n8n (is the PC on?)', prompt: null };
  if (mood === 'busy') return { summary: 'Sending your absence…', prompt: null };
  if (mood === 'away') return { summary: 'You are away today', prompt: null };
  const next = upcomingDays(list.absences, today)[0];
  return next ? { summary: `Next absence: ${next.date}`, prompt: null } : { summary: 'No absence planned', prompt: 'Book a day off' };
}
