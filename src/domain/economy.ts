import type { AppData, Goal, GoalTier, LedgerEntry, Milestone, Project, Task } from './types';
import { addDays, diffDays, isoToDay, startOfWeek } from './dates';
import { pointsBetween, sumPoints } from './services';

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

/** A finished project pays a base plus a share of its finished tasks' points, once they reach a minimum. */
export const PROJECT_BASE = 200;
export const PROJECT_PER_POINT = 5;
export const PROJECT_MIN_POINTS = 10;
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

export const WELCOME_KEY = 'welcome';
export const weekKey = (weekStart: string) => `week:${weekStart}`;
export const projectKey = (id: string) => `project:${id}`;
export const milestoneKey = (id: string) => `milestone:${id}`;
export const goalKey = (id: string) => `goal:${id}`;
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
  total: number;
}

/** What a week with `points` pays, given the streak of qualifying weeks right before it. */
export function weekBounty(start: string, points: number, streakBefore: number): WeekBounty {
  const qualified = points >= WEEKLY_MIN;
  const streak = qualified ? streakBefore + 1 : 0;
  const multiplier = qualified ? streakMultiplier(streak) : 1;
  const bonus = points >= OVERACHIEVER_MIN ? OVERACHIEVER_BONUS : 0;
  const total = qualified ? Math.round(points * BERRIES_PER_POINT * multiplier) + bonus : 0;
  return { start, end: addDays(start, 6), points, qualified, streak, multiplier, bonus, total };
}

/**
 * Walks every week since the economy started. Claimed weeks keep their frozen numbers (later edits to old tasks never
 * change a paid bounty); unclaimed ones are computed from the tasks as they are now.
 */
function walkWeeks(d: AppData, today: string): { closed: { bounty: WeekBounty; claimed: boolean }[]; streakBefore: number } {
  const start = economyStart(d.ledger);
  const closed: { bounty: WeekBounty; claimed: boolean }[] = [];
  if (!start) return { closed, streakBefore: 0 };
  const current = startOfWeek(today);
  const byKey = new Map(d.ledger.map((e) => [e.key, e]));
  let streak = 0;
  for (let w = startOfWeek(start); w < current; w = addDays(w, 7)) {
    const paid = byKey.get(weekKey(w))?.week;
    const bounty = paid
      ? { ...weekBounty(w, paid.points, 0), streak: paid.streak, multiplier: paid.multiplier, bonus: paid.bonus, total: byKey.get(weekKey(w))!.amount }
      : weekBounty(w, pointsBetween(d.tasks, w, addDays(w, 6)), streak);
    closed.push({ bounty, claimed: !!paid });
    streak = bounty.streak;
  }
  return { closed, streakBefore: streak };
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
  const b = weekBounty(start, pointsBetween(d.tasks, start, today), streakBefore);
  return { ...b, streakBefore, toMinimum: Math.max(0, WEEKLY_MIN - b.points) };
}

export function welcomeEntry(id: string, at: string): LedgerEntry {
  return { id, key: WELCOME_KEY, kind: 'welcome', amount: WELCOME_GIFT, label: 'Welcome gift', at };
}

export function bountyEntry(id: string, at: string, b: WeekBounty): LedgerEntry {
  return {
    id, key: weekKey(b.start), kind: 'weekly', amount: b.total, at,
    label: b.qualified ? `Weekly bounty · ${b.points} pts` : `Week closed · ${b.points} pts (below ${WEEKLY_MIN})`,
    week: { start: b.start, points: b.points, streak: b.streak, multiplier: b.multiplier, bonus: b.bonus },
  };
}

/* ───────── Completion rewards: paid the moment a project, milestone or goal is finished ───────── */

/** What finishing the project pays now: base + points of its finished tasks, or nothing below the minimum. */
export function projectReward(project: Pick<Project, 'id'>, tasks: Task[]): { points: number; amount: number } {
  const points = sumPoints(tasks.filter((t) => t.projectId === project.id && t.status === 'done'));
  return { points, amount: points >= PROJECT_MIN_POINTS ? PROJECT_BASE + points * PROJECT_PER_POINT : 0 };
}

export function milestoneReward(m: Pick<Milestone, 'id'>, tasks: Task[]): number {
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
