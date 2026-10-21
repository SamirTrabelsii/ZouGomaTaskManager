import type { AppData, CertLevel, Certification, Goal, GoalTier, Habit, HabitLog, LedgerEntry, Milestone, Project, Task } from './types';
import { addDays, diffDays, isoToDay, startOfWeek } from './dates';
import { sumPoints, taskPoints } from './services';

/* ───────── Berries (฿): rewards earned from finished work, spent later in the card store ───────── */

/** A week pays nothing below this many story points. */
export const WEEKLY_MIN = 30;
/** Weeks at or above this many points also earn {@link OVERACHIEVER_BONUS}. */
export const OVERACHIEVER_MIN = 60;
export const OVERACHIEVER_BONUS = 250;
export const BERRIES_PER_POINT = 10;
/** Each consecutive qualifying week adds this much to the multiplier, up to {@link MAX_MULTIPLIER}. */
export const STREAK_STEP = 0.1;
export const MAX_MULTIPLIER = 1.5;
/** Paid once when the treasury is opened, worth a few packs. */
export const WELCOME_GIFT = 450;

/** A finished project pays this, if at least one of its tasks is finished. */
export const PROJECT_REWARD = 200;
/** At most this many projects (and milestones) pay per week (Mon–Sun), so closing throwaway projects can't print Berries. */
export const PROJECTS_PER_WEEK = 3;
export const MILESTONES_PER_WEEK = 5;
/** Each habit kept for a whole week (every day, or its weekly target) adds this to the week's bounty. */
export const HABIT_WEEK_REWARD = 25;
/** A reached milestone pays this, if at least one finished task is linked to it. */
export const MILESTONE_REWARD = 50;
/**
 * Goal tiers. `minDays` is how long the goal must have had its tier before the tier pays in full; a goal reached
 * sooner pays the biggest tier its age allows (so a "Legendary" goal can't be created and finished the same day).
 */
export const GOAL_TIERS: Record<GoalTier, { label: string; amount: number; minDays: number }> = {
  S: { label: 'Small', amount: 300, minDays: 0 },
  M: { label: 'Medium', amount: 750, minDays: 7 },
  L: { label: 'Big', amount: 1500, minDays: 30 },
  XL: { label: 'Legendary', amount: 3000, minDays: 90 },
};
export const GOAL_TIER_IDS = Object.keys(GOAL_TIERS) as GoalTier[];
/** Paid once, the first time a certification is marked earned. */
export const CERT_REWARD: Record<CertLevel, number> = { badge: 50, foundational: 100, associate: 500, professional: 1000, expert: 3000 };

export const WELCOME_KEY = 'welcome';
export const weekKey = (weekStart: string) => `week:${weekStart}`;
export const projectKey = (id: string) => `project:${id}`;
export const milestoneKey = (id: string) => `milestone:${id}`;
export const goalKey = (id: string) => `goal:${id}`;
export const certKey = (id: string) => `cert:${id}`;
export const paidAmount = (ledger: LedgerEntry[], key: string): number | null => {
  const e = ledger.find((x) => x.key === key);
  return e ? e.amount : null;
};

export const balance = (ledger: LedgerEntry[]) => ledger.reduce((n, e) => n + e.amount, 0);
/** Everything ever earned from work (rewards and bounties), ignoring spending and card sales. */
export const lifetimeEarned = (ledger: LedgerEntry[]) =>
  ledger.reduce((n, e) => n + (e.kind === 'sale' ? 0 : Math.max(0, e.amount)), 0);
export const formatBerries = (n: number) => `฿${Math.round(n).toLocaleString('en-US')}`;

/** The day the economy started (the welcome gift), or null while the treasury is still closed. */
export function economyStart(ledger: LedgerEntry[]): string | null {
  const w = ledger.find((e) => e.key === WELCOME_KEY);
  return w ? isoToDay(w.at) : null;
}

export const streakMultiplier = (streak: number) =>
  streak < 1 ? 1 : Math.min(MAX_MULTIPLIER, Math.round((1 + STREAK_STEP * (streak - 1)) * 100) / 100);

export interface WeekBounty {
  start: string;
  end: string;
  points: number;
  qualified: boolean;
  /** Consecutive qualifying weeks ending with this one; 0 when this week did not qualify. */
  streak: number;
  multiplier: number;
  bonus: number;
  /** Habits kept the whole week, each paying {@link HABIT_WEEK_REWARD}, whatever the points. */
  habits: number;
  habitBonus: number;
  total: number;
}

/** What a week with `points` and `habits` kept pays, given the streak of qualifying weeks right before it. */
export function weekBounty(start: string, points: number, streakBefore: number, habits = 0): WeekBounty {
  const qualified = points >= WEEKLY_MIN;
  const streak = qualified ? streakBefore + 1 : 0;
  const multiplier = qualified ? streakMultiplier(streak) : 1;
  const bonus = points >= OVERACHIEVER_MIN ? OVERACHIEVER_BONUS : 0;
  const habitBonus = habits * HABIT_WEEK_REWARD;
  const total = (qualified ? Math.round(points * BERRIES_PER_POINT * multiplier) + bonus : 0) + habitBonus;
  return { start, end: addDays(start, 6), points, qualified, streak, multiplier, bonus, habits, habitBonus, total };
}

/** Points finished per day and logged days per habit: built once per change of the data, then read week by week. */
interface Activity { points: Map<string, number>; logs: Map<string, Set<string>>; habits: Habit[] }
let activityMemo: { tasks: Task[]; habits: Habit[]; logs: HabitLog[]; value: Activity } | null = null;

function activityOf(tasks: Task[], habits: Habit[], logs: HabitLog[]): Activity {
  const m = activityMemo;
  if (m && m.tasks === tasks && m.habits === habits && m.logs === logs) return m.value;
  const points = new Map<string, number>();
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const day = isoToDay(t.completedAt);
    points.set(day, (points.get(day) ?? 0) + taskPoints(t));
  }
  const byHabit = new Map<string, Set<string>>();
  for (const l of logs) {
    let days = byHabit.get(l.habitId);
    if (!days) byHabit.set(l.habitId, (days = new Set()));
    days.add(l.date);
  }
  const value = { points, logs: byHabit, habits };
  activityMemo = { tasks, habits, logs, value };
  return value;
}

function pointsIn(a: Activity, from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) n += a.points.get(d) ?? 0;
  return n;
}

function keptIn(a: Activity, weekStart: string, until: string): number {
  return a.habits.filter((h) => {
    if (isoToDay(h.createdAt) > weekStart) return false;
    const days = a.logs.get(h.id);
    if (!days) return false;
    if (h.frequency === 'weekly') {
      let n = 0;
      for (let d = weekStart; d <= until; d = addDays(d, 1)) if (days.has(d)) n++;
      return n >= h.target;
    }
    for (let d = weekStart; d <= until; d = addDays(d, 1)) if (!days.has(d)) return false;
    return true;
  }).length;
}

/**
 * Habits kept the week starting `weekStart`, counting days up to `until` (the week's last day once it is over).
 * A habit counts only if it existed when the week began: daily ones need a log every day, weekly ones their target.
 */
export function habitsKept(habits: Habit[], logs: HabitLog[], weekStart: string, until = addDays(weekStart, 6)): number {
  return keptIn(activityOf([], habits, logs), weekStart, until);
}

type Walk = { closed: { bounty: WeekBounty; claimed: boolean }[]; streakBefore: number };
let walkMemo: { tasks: Task[]; habits: Habit[]; logs: HabitLog[]; ledger: LedgerEntry[]; today: string; value: Walk } | null = null;

/**
 * Walks every week since the economy started. Claimed weeks keep their frozen numbers (later edits to old tasks never
 * change a paid bounty); unclaimed ones are computed from the tasks as they are now. The header, the room and the
 * Wallet all ask on every change, so the last answer is kept until the data or the day changes.
 */
function walkWeeks(d: AppData, today: string): Walk {
  const m = walkMemo;
  if (m && m.tasks === d.tasks && m.habits === d.habits && m.logs === d.habitLogs && m.ledger === d.ledger && m.today === today) return m.value;
  const start = economyStart(d.ledger);
  const closed: Walk['closed'] = [];
  if (!start) return { closed, streakBefore: 0 };
  const a = activityOf(d.tasks, d.habits, d.habitLogs);
  const current = startOfWeek(today);
  const byKey = new Map(d.ledger.map((e) => [e.key, e]));
  let streak = 0;
  for (let w = startOfWeek(start); w < current; w = addDays(w, 7)) {
    const paid = byKey.get(weekKey(w))?.week;
    const end = addDays(w, 6);
    const bounty = paid
      ? { ...weekBounty(w, paid.points, 0, paid.habits ?? 0), streak: paid.streak, multiplier: paid.multiplier, bonus: paid.bonus, total: byKey.get(weekKey(w))!.amount }
      : weekBounty(w, pointsIn(a, w, end), streak, keptIn(a, w, end));
    closed.push({ bounty, claimed: !!paid });
    streak = bounty.streak;
  }
  const value = { closed, streakBefore: streak };
  walkMemo = { tasks: d.tasks, habits: d.habits, logs: d.habitLogs, ledger: d.ledger, today, value };
  return value;
}

/** Finished weeks whose bounty has not been collected yet, oldest first. Empty until the treasury is opened. */
export function pendingBounties(d: AppData, today: string): WeekBounty[] {
  return walkWeeks(d, today).closed.filter((w) => !w.claimed).map((w) => w.bounty);
}

/**
 * The week in progress: points so far and what it would pay if it closed now. The streak assumes pending weeks will
 * be collected as they stand.
 */
export function currentWeek(d: AppData, today: string): WeekBounty & { toMinimum: number; streakBefore: number } {
  const start = startOfWeek(today);
  const { streakBefore } = walkWeeks(d, today);
  const a = activityOf(d.tasks, d.habits, d.habitLogs);
  // habits "on track": kept every day so far, or already at their weekly target
  const b = weekBounty(start, pointsIn(a, start, today), streakBefore, keptIn(a, start, today));
  return { ...b, streakBefore, toMinimum: Math.max(0, WEEKLY_MIN - b.points) };
}

export function welcomeEntry(id: string, at: string): LedgerEntry {
  return { id, key: WELCOME_KEY, kind: 'welcome', amount: WELCOME_GIFT, label: 'Welcome gift', at };
}

export function bountyEntry(id: string, at: string, b: WeekBounty): LedgerEntry {
  return {
    id, key: weekKey(b.start), kind: 'weekly', amount: b.total, at,
    label: (b.qualified ? `Weekly bounty · ${b.points} pts` : `Week closed · ${b.points} pts (below ${WEEKLY_MIN})`)
      + (b.habits ? ` · ${b.habits} habit${b.habits === 1 ? '' : 's'} kept` : ''),
    week: { start: b.start, points: b.points, streak: b.streak, multiplier: b.multiplier, bonus: b.bonus, habits: b.habits },
  };
}

/* ───────── Completion rewards: paid the moment a project, milestone or goal is finished ───────── */

/** How many rewards of `kind` were paid during the week (Mon–Sun) containing `today`. */
export function paidThisWeek(ledger: LedgerEntry[], kind: LedgerEntry['kind'], today: string): number {
  const start = startOfWeek(today);
  const end = addDays(start, 6);
  return ledger.filter((e) => e.kind === kind && e.amount > 0 && isoToDay(e.at) >= start && isoToDay(e.at) <= end).length;
}

/**
 * What finishing the project pays now: a flat reward once at least one of its tasks is finished, unless this week's
 * project rewards are used up (`capped`; it can still pay when finished again from next Monday).
 */
export function projectReward(project: Pick<Project, 'id'>, tasks: Task[], ledger: LedgerEntry[], today: string): { points: number; amount: number; capped: boolean } {
  const done = tasks.filter((t) => t.projectId === project.id && t.status === 'done');
  const capped = done.length > 0 && paidThisWeek(ledger, 'project', today) >= PROJECTS_PER_WEEK;
  return { points: sumPoints(done), amount: done.length && !capped ? PROJECT_REWARD : 0, capped };
}

export function milestoneReward(m: Pick<Milestone, 'id'>, tasks: Task[], ledger: LedgerEntry[], today: string): number {
  if (paidThisWeek(ledger, 'milestone', today) >= MILESTONES_PER_WEEK) return 0;
  return tasks.some((t) => t.milestoneId === m.id && t.status === 'done') ? MILESTONE_REWARD : 0;
}

/**
 * What reaching the goal pays on `today`: its tier, or the biggest smaller tier its age allows. `fullOn` is the day the
 * chosen tier pays in full (null once it does).
 */
export function goalReward(goal: Pick<Goal, 'reward' | 'rewardSetAt'>, today: string): { tier: GoalTier | null; amount: number; fullOn: string | null } {
  if (!goal.reward || !goal.rewardSetAt) return { tier: null, amount: 0, fullOn: null };
  const age = diffDays(isoToDay(goal.rewardSetAt), today);
  const chosen = GOAL_TIERS[goal.reward];
  const allowed = GOAL_TIER_IDS.slice(0, GOAL_TIER_IDS.indexOf(goal.reward) + 1).filter((t) => age >= GOAL_TIERS[t].minDays);
  const tier = allowed[allowed.length - 1];
  return {
    tier,
    amount: GOAL_TIERS[tier].amount,
    fullOn: age >= chosen.minDays ? null : addDays(isoToDay(goal.rewardSetAt), chosen.minDays),
  };
}

export function projectEntry(id: string, at: string, project: Pick<Project, 'id' | 'title'>, r: { points: number; amount: number }): LedgerEntry {
  return { id, key: projectKey(project.id), kind: 'project', amount: r.amount, at, label: `Project complete · ${project.title} (${r.points} pts)` };
}

export function milestoneEntry(id: string, at: string, m: Pick<Milestone, 'id' | 'title'>, amount: number): LedgerEntry {
  return { id, key: milestoneKey(m.id), kind: 'milestone', amount, at, label: `Milestone · ${m.title}` };
}

export function goalEntry(id: string, at: string, goal: Pick<Goal, 'id' | 'title'>, r: { tier: GoalTier | null; amount: number }): LedgerEntry {
  return { id, key: goalKey(goal.id), kind: 'goal', amount: r.amount, at, label: `Goal reached · ${goal.title}${r.tier ? ` (${GOAL_TIERS[r.tier].label})` : ''}` };
}

export function certEntry(id: string, at: string, c: Pick<Certification, 'id' | 'title' | 'level'>): LedgerEntry {
  return { id, key: certKey(c.id), kind: 'cert', amount: CERT_REWARD[c.level], at, label: `Certified · ${c.title}` };
}

/* ───────── In the room ───────── */

/** Coins piled in the room's treasure chest: none when empty, then growing with the balance (a few per doubling), up to 40. */
export const chestCoins = (berries: number) =>
  berries <= 0 ? 0 : Math.min(40, 6 + Math.round(Math.log2(1 + berries / 150) * 5));

/** The wanted poster's bounty: lifetime Berries earned from work, written like a bounty ("12,450"). */
export const posterBounty = (ledger: LedgerEntry[]) => Math.round(lifetimeEarned(ledger)).toLocaleString('en-US');
