import type { AppData, CalEvent, Goal, Habit, HabitLog, Milestone, Project, Task, TaskSize } from './types';
import { addDays, dateTimeOf, daysRange, diffDays, isoToDay, startOfWeek } from './dates';

/* ───────── Tasks ───────── */

export const isOpen = (t: Task) => t.status !== 'done';
/** Open and not parked: what actually competes for attention today. */
export const isActive = (t: Task) => t.status !== 'done' && t.status !== 'onhold';
/** On-hold tasks whose resume date has come. */
export const readyToResume = (tasks: Task[], today: string) =>
  tasks.filter((t) => t.status === 'onhold' && t.resumeOn && t.resumeOn <= today);

/** Story points behind each task size. */
export const SIZE_POINTS: Record<TaskSize, number> = { XS: 1, S: 2, M: 4, L: 8, XL: 16, XXL: 32 };
export const TASK_SIZES = Object.keys(SIZE_POINTS) as TaskSize[];
/** Points a task is worth; unsized tasks count 0. */
export const taskPoints = (t: Pick<Task, 'size'>) => (t.size ? SIZE_POINTS[t.size] ?? 0 : 0);
export const sumPoints = (tasks: Pick<Task, 'size'>[]) => tasks.reduce((n, t) => n + taskPoints(t), 0);
/** Points of the tasks finished between two days (inclusive). */
export const pointsBetween = (tasks: Task[], from: string, to: string) =>
  sumPoints(tasks.filter((t) => t.completedAt && isoToDay(t.completedAt) >= from && isoToDay(t.completedAt) <= to));

/** Points collected (tasks finished) on each of the last `n` days ending at `end`. */
export function pointsByDay(tasks: Task[], end: string, n: number) {
  return daysRange(end, n).map((day) => ({
    day,
    points: sumPoints(tasks.filter((t) => t.completedAt && isoToDay(t.completedAt) === day)),
  }));
}
const prioRank = { high: 0, medium: 1, low: 2 } as const;

export function sortTasks(tasks: Task[], by: 'due' | 'priority' | 'created' | 'title' | 'size' = 'due'): Task[] {
  const arr = [...tasks];
  arr.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    switch (by) {
      case 'priority':
        return prioRank[a.priority] - prioRank[b.priority] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9');
      case 'size':
        return taskPoints(b) - taskPoints(a) || prioRank[a.priority] - prioRank[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
      case 'created':
        return b.createdAt.localeCompare(a.createdAt);
      case 'title':
        return a.title.localeCompare(b.title);
      default:
        // Closest due date first; tasks without one follow, oldest created first.
        return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || prioRank[a.priority] - prioRank[b.priority] || (a.dueDate ? 0 : a.createdAt.localeCompare(b.createdAt));
    }
  });
  return arr;
}

/** Milestones by due date, closest first; undated ones go last in the order they were added. */
export function sortMilestones(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

export const overdueTasks =(tasks: Task[], today: string) =>
  tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate < today);
export const todayTasks = (tasks: Task[], today: string) =>
  tasks.filter((t) => isOpen(t) && t.dueDate === today);
export const upcomingTasks = (tasks: Task[], today: string, days = 14) =>
  tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate > today && diffDays(today, t.dueDate) <= days);

/** How a due date relates to today – drives the colour coding of task rows. Finished tasks have no tone. */
export type DueTone = 'overdue' | 'today' | 'soon' | 'later';
export function dueTone(t: Task, today: string, soonDays = 7): DueTone | null {
  if (!isOpen(t) || !t.dueDate) return null;
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  return diffDays(today, t.dueDate) <= soonDays ? 'soon' : 'later';
}

/** Today's scope: open tasks due today or earlier (minus anything parked on hold), plus everything finished today. */
export function dailyProgress(tasks: Task[], today: string) {
  const done = tasks.filter((t) => t.completedAt && isoToDay(t.completedAt) === today).length;
  const remaining = tasks.filter((t) => isOpen(t) && t.status !== 'onhold' && t.dueDate && t.dueDate <= today).length;
  const total = done + remaining;
  return { done, remaining, total, ratio: total ? done / total : 0 };
}

/* ───────── Projects & goals ───────── */

export function projectProgress(project: Project, tasks: Task[], milestones: Milestone[]) {
  if (project.status === 'done') return { done: 1, total: 1, ratio: 1 };
  const ts = tasks.filter((t) => t.projectId === project.id);
  const ms = milestones.filter((m) => m.projectId === project.id);
  const total = ts.length + ms.length;
  const done = ts.filter((t) => t.status === 'done').length + ms.filter((m) => m.done).length;
  return { done, total, ratio: total ? done / total : 0 };
}

export function goalProgress(goal: Goal) {
  return goal.target > 0 ? Math.max(0, Math.min(1, goal.current / goal.target)) : 0;
}

/* ───────── Habits ───────── */

const habitDates = (h: Habit, logs: HabitLog[]) => logs.filter((l) => l.habitId === h.id).map((l) => l.date);

export function habitDoneOn(h: Habit, logs: HabitLog[], day: string) {
  return logs.some((l) => l.habitId === h.id && l.date === day);
}
export function weekCount(h: Habit, logs: HabitLog[], day: string) {
  const ws = startOfWeek(day);
  const we = addDays(ws, 6);
  return habitDates(h, logs).filter((d) => d >= ws && d <= we).length;
}
/** "Done for now": daily → logged today; weekly → weekly target met. */
export function habitSatisfied(h: Habit, logs: HabitLog[], today: string) {
  return h.frequency === 'daily' ? habitDoneOn(h, logs, today) : weekCount(h, logs, today) >= h.target;
}

interface Period { met: boolean; current: boolean }
function periods(h: Habit, logs: HabitLog[], today: string): Period[] {
  const dates = habitDates(h, logs).sort();
  if (!dates.length) return [];
  const set = new Set(dates);
  const out: Period[] = [];
  if (h.frequency === 'daily') {
    for (let d = dates[0]; d <= today; d = addDays(d, 1)) out.push({ met: set.has(d), current: d === today });
  } else {
    const thisWeek = startOfWeek(today);
    for (let w = startOfWeek(dates[0]); w <= thisWeek; w = addDays(w, 7)) {
      const n = dates.filter((d) => d >= w && d <= addDays(w, 6)).length;
      out.push({ met: n >= h.target, current: w === thisWeek });
    }
  }
  return out;
}

/** Streaks never punish: the in-progress period is simply ignored until it is met. */
export function streaks(h: Habit, logs: HabitLog[], today: string) {
  const ps = periods(h, logs, today);
  let best = 0, run = 0;
  for (const p of ps) {
    if (p.met) { run++; best = Math.max(best, run); }
    else if (!p.current) run = 0;
  }
  let current = 0;
  for (let i = ps.length - 1; i >= 0; i--) {
    if (ps[i].met) current++;
    else if (!ps[i].current) break;
  }
  return { current, best };
}

/** 0..1 share of recent periods that were met (capped, newest habits aren't penalised for days before they existed). */
export function consistency(h: Habit, logs: HabitLog[], today: string, windowDays = 28) {
  const since = Math.min(windowDays, Math.max(1, diffDays(isoToDay(h.createdAt), today) + 1));
  const dates = habitDates(h, logs);
  if (h.frequency === 'daily') {
    const from = addDays(today, -(since - 1));
    return Math.min(1, dates.filter((d) => d >= from && d <= today).length / since);
  }
  const weeks = Math.max(1, Math.min(4, Math.ceil(since / 7)));
  const from = addDays(startOfWeek(today), -(weeks - 1) * 7);
  let sum = 0;
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(from, i * 7);
    const n = dates.filter((d) => d >= ws && d <= addDays(ws, 6)).length;
    sum += Math.min(n, h.target);
  }
  return Math.min(1, sum / (h.target * weeks));
}

export const PLANT_STAGES = ['Seed', 'Sprout', 'Growing', 'Flourishing', 'Blooming'] as const;

/**
 * Growth is driven by lifetime completions only, so it can never shrink. Recent consistency just
 * tints the foliage (vigor ranges 0.7–1) – a missed week dims nothing below a healthy green.
 */
export function plantGrowth(h: Habit, logs: HabitLog[], today: string) {
  const total = habitDates(h, logs).length;
  const size = Math.min(1, Math.log(1 + total) / Math.log(1 + 90));
  const vigor = 0.7 + 0.3 * consistency(h, logs, today, 14);
  const stage = total === 0 ? 0 : total < 4 ? 1 : total < 15 ? 2 : total < 45 ? 3 : 4;
  return { total, size, vigor, stage, stageName: PLANT_STAGES[stage] };
}

export function habitCompletionToday(habits: Habit[], logs: HabitLog[], today: string) {
  const act = habits.filter((h) => !h.archived);
  const done = act.filter((h) => habitSatisfied(h, logs, today)).length;
  return { done, total: act.length, ratio: act.length ? done / act.length : 0 };
}

/* ───────── Calendar ───────── */

export type AgendaKind = 'event' | 'deadline' | 'task' | 'milestone' | 'project' | 'cert' | 'reminder' | 'external';
export interface AgendaItem {
  key: string;
  kind: AgendaKind;
  date: string;
  time: string | null;
  title: string;
  refId: string;
  done?: boolean;
  /** Imported (read-only) meetings carry their calendar's colour and name. */
  color?: string;
  feedName?: string;
  /** End of an imported single-day timed meeting (HH:mm). */
  endTime?: string | null;
  /** Full extent of an imported meeting (local time), repeated on every day it touches. */
  span?: { startDay: string; lastDay: string; startTime: string | null; endTime: string | null; allDay: boolean };
}

/** Everything that lands on a date: events, deadlines, scheduled tasks, milestones, certification exams and expiries, reminders – plus any imported meetings passed in. */
export function agendaItems(d: AppData, imported: AgendaItem[] = []): AgendaItem[] {
  const out: AgendaItem[] = [...imported];
  d.events.forEach((e) => out.push({ key: 'e' + e.id, kind: e.kind, date: e.date, time: e.time, endTime: e.endTime, title: e.title, refId: e.id }));
  d.tasks.forEach((t) => {
    if (t.dueDate) out.push({ key: 't' + t.id, kind: 'task', date: t.dueDate, time: null, title: t.title, refId: t.id, done: t.status === 'done' });
  });
  d.milestones.forEach((m) => {
    if (m.dueDate) out.push({ key: 'm' + m.id, kind: 'milestone', date: m.dueDate, time: null, title: m.title, refId: m.id, done: m.done });
  });
  d.projects.forEach((p) => {
    if (p.deadline && p.status !== 'done') out.push({ key: 'p' + p.id, kind: 'project', date: p.deadline, time: null, title: `${p.title} deadline`, refId: p.id });
  });
  d.certifications.forEach((c) => {
    if (c.status !== 'earned' && c.examDate) out.push({ key: 'ce' + c.id, kind: 'cert', date: c.examDate, time: null, title: `${c.title} exam`, refId: c.id });
    if (c.status === 'earned' && c.expiresOn) out.push({ key: 'cx' + c.id, kind: 'cert', date: c.expiresOn, time: null, title: `${c.title} expires`, refId: c.id });
  });
  d.reminders.forEach((r) => {
    if (!r.link) out.push({ key: 'r' + r.id, kind: 'reminder', date: r.at.slice(0, 10), time: r.at.slice(11, 16), title: r.title, refId: r.id });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
}

export function nextEvent(events: CalEvent[], now = new Date()): CalEvent | null {
  const upcoming = events
    .filter((e) => dateTimeOf(e.date, e.endTime ?? e.time ?? '23:59').getTime() >= now.getTime())
    .sort((a, b) => dateTimeOf(a.date, a.time).getTime() - dateTimeOf(b.date, b.time).getTime());
  return upcoming[0] ?? null;
}

export interface NextUp { title: string; date: string; time: string | null; color?: string }

/**
 * The next thing on the calendar: your own events plus imported meetings (a meeting in progress still counts).
 * Imported all-day entries (holidays, "out of office" markers) are left out so they never hide a real meeting.
 */
export function nextUp(events: CalEvent[], imported: AgendaItem[], now = new Date()): NextUp | null {
  const cands: (NextUp & { at: number })[] = [];
  const own = nextEvent(events, now);
  if (own) cands.push({ title: own.title, date: own.date, time: own.time, at: dateTimeOf(own.date, own.time).getTime() });
  for (const i of imported) {
    if (i.kind !== 'external' || !i.time) continue;
    if (dateTimeOf(i.date, i.endTime ?? i.time).getTime() < now.getTime()) continue;
    cands.push({ title: i.title, date: i.date, time: i.time, color: i.color, at: dateTimeOf(i.date, i.time).getTime() });
  }
  cands.sort((a, b) => a.at - b.at);
  const first = cands[0];
  return first ? { title: first.title, date: first.date, time: first.time, color: first.color } : null;
}

/* ───────── Insights ───────── */

export function completedByDay(tasks: Task[], end: string, n: number) {
  return daysRange(end, n).map((day) => ({
    day,
    count: tasks.filter((t) => t.completedAt && isoToDay(t.completedAt) === day).length,
  }));
}

export function habitRatioByDay(habits: Habit[], logs: HabitLog[], end: string, n: number) {
  const dailies = habits.filter((h) => !h.archived && h.frequency === 'daily');
  return daysRange(end, n).map((day) => {
    const created = dailies.filter((h) => isoToDay(h.createdAt) <= day);
    const done = created.filter((h) => habitDoneOn(h, logs, day)).length;
    return { day, done, total: created.length, ratio: created.length ? done / created.length : 0 };
  });
}

export function weeklySummary(d: AppData, weekStart: string) {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (iso: string | null) => !!iso && isoToDay(iso) >= weekStart && isoToDay(iso) <= weekEnd;
  const dayIn = (s: string) => s >= weekStart && s <= weekEnd;
  return {
    weekStart,
    weekEnd,
    tasksCompleted: d.tasks.filter((t) => inWeek(t.completedAt)).length,
    pointsCompleted: pointsBetween(d.tasks, weekStart, weekEnd),
    tasksCreated: d.tasks.filter((t) => inWeek(t.createdAt)).length,
    tasksOpen: d.tasks.filter(isOpen).length,
    habitLogs: d.habitLogs.filter((l) => dayIn(l.date)).length,
    milestonesDone: d.milestones.filter((m) => inWeek(m.completedAt)).length,
    notesWritten: d.notes.filter((n) => inWeek(n.createdAt)).length,
    eventsCount: d.events.filter((e) => dayIn(e.date)).length,
  };
}

/** 0..1 sense of recent momentum — a *current* mood for the room, never a stored score. */
export function liveliness(d: AppData, today: string): number {
  const from = addDays(today, -13);
  const act =
    d.tasks.filter((t) => t.completedAt && isoToDay(t.completedAt) >= from).length +
    d.habitLogs.filter((l) => l.date >= from).length +
    d.notes.filter((n) => isoToDay(n.createdAt) >= from).length;
  return Math.min(1, act / 30);
}
