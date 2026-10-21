import type { AppData, LedgerEntry } from './types';
import { addDays, isoToDay, startOfWeek } from './dates';
import { pointsBetween } from './services';

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

export const WELCOME_KEY = 'welcome';
export const weekKey = (weekStart: string) => `week:${weekStart}`;

export const balance = (ledger: LedgerEntry[]) => ledger.reduce((n, e) => n + e.amount, 0);
/** Everything ever earned, ignoring spending. */
export const lifetimeEarned = (ledger: LedgerEntry[]) => ledger.reduce((n, e) => n + Math.max(0, e.amount), 0);
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
