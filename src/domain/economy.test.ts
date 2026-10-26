import { describe, expect, it } from 'vitest';
import {
  balance, bountyEntry, chestCoins, currentWeek, posterBounty, economyStart, goalReward, lifetimeEarned, milestoneReward, pendingBounties,
  earningsByWeek, earningTotals, habitsKept, milestoneEntry, projectEntry, projectReward, streakMultiplier, weekBounty, welcomeEntry, WELCOME_GIFT,
} from './economy';
import { emptyData, normalize } from '../data/storage';
import type { AppData, LedgerEntry, Task, TaskSize } from './types';

const task = (completedDay: string, size: TaskSize): Task => ({
  id: Math.random().toString(), title: 't', notes: '', status: 'done', priority: 'medium', size, dueDate: null,
  projectId: null, milestoneId: null, goalId: null, scopeId: null, blockedBy: '', resumeOn: null,
  createdAt: '2026-01-01T10:00:00', completedAt: new Date(`${completedDay}T12:00:00`).toISOString(),
});
/** Mondays: 2026-10-05, 10-12, 10-19, 10-26. */
const opened = (on = '2026-10-05'): LedgerEntry => welcomeEntry('w', new Date(`${on}T09:00:00`).toISOString());
const data = (o: Partial<AppData>): AppData => ({ ...emptyData(), ...o });

describe('bounty memo', () => {
  it('a new copy of the data is computed afresh, never served stale', () => {
    const d = data({ ledger: [opened()], tasks: [task('2026-10-06', 'XXL')] });
    expect(pendingBounties(d, '2026-10-13')[0].points).toBe(32);
    const more = { ...d, tasks: [...d.tasks, task('2026-10-07', 'S')] };
    expect(pendingBounties(more, '2026-10-13')[0].points).toBe(34);
    expect(pendingBounties(d, '2026-10-13')[0].points).toBe(32);
    expect(pendingBounties(d, '2026-10-20').map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12']);
  });
});

describe('weekly bounty', () => {
  it('pays nothing below 30 points', () => {
    const b = weekBounty('2026-10-05', 29, 0);
    expect(b.qualified).toBe(false);
    expect(b.total).toBe(0);
    expect(b.streak).toBe(0);
  });
  it('pays 10 berries per point from 30 points', () => {
    expect(weekBounty('2026-10-05', 30, 0).total).toBe(300);
  });
  it('a streak raises the multiplier by 0.1 per week, capped at 1.5', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBe(1.1);
    expect(streakMultiplier(6)).toBe(1.5);
    expect(streakMultiplier(20)).toBe(1.5);
    expect(weekBounty('2026-10-05', 40, 2).total).toBe(480); // third week in a row: 40 × 10 × 1.2
  });
  it('60+ points adds the over-achiever bonus', () => {
    expect(weekBounty('2026-10-05', 60, 0).total).toBe(850);
  });
  it('a missed week resets the streak', () => {
    expect(weekBounty('2026-10-05', 10, 5).streak).toBe(0);
  });
});

describe('pending bounties', () => {
  it('nothing is pending before the treasury is opened', () => {
    expect(economyStart([])).toBeNull();
    expect(pendingBounties(data({ tasks: [task('2026-10-06', 'XXL')] }), '2026-10-20')).toEqual([]);
  });
  it('lists every closed week since opening, oldest first, but never the week in progress', () => {
    const d = data({ ledger: [opened()], tasks: [task('2026-10-06', 'XXL'), task('2026-10-13', 'S'), task('2026-10-20', 'XXL')] });
    const p = pendingBounties(d, '2026-10-21');
    expect(p.map((w) => [w.start, w.points])).toEqual([['2026-10-05', 32], ['2026-10-12', 2]]);
  });
  it('weeks before the treasury opened never pay', () => {
    const d = data({ ledger: [opened('2026-10-14')], tasks: [task('2026-10-06', 'XXL')] });
    expect(pendingBounties(d, '2026-10-21').map((w) => w.start)).toEqual(['2026-10-12']);
  });
  it('chains the streak across several unclaimed weeks', () => {
    const d = data({ ledger: [opened()], tasks: [task('2026-10-06', 'XXL'), task('2026-10-13', 'XXL')] });
    const [a, b] = pendingBounties(d, '2026-10-21');
    expect(a.streak).toBe(1);
    expect(b.streak).toBe(2);
    expect(b.total).toBe(352);
  });
  it('a collected week is frozen: editing old tasks later changes neither it nor the streak it started', () => {
    const t = task('2026-10-06', 'XXL');
    const paid = bountyEntry('b', '2026-10-12T08:00:00.000Z', weekBounty('2026-10-05', 32, 0));
    const d = data({ ledger: [opened(), paid], tasks: [{ ...t, status: 'todo', completedAt: null }, task('2026-10-13', 'XXL')] });
    const p = pendingBounties(d, '2026-10-21');
    expect(p.map((w) => w.start)).toEqual(['2026-10-12']);
    expect(p[0].streak).toBe(2);
  });
  it('a week closed below the minimum is still recorded, so it is not offered again', () => {
    const closed = bountyEntry('b', '2026-10-12T08:00:00.000Z', weekBounty('2026-10-05', 3, 0));
    expect(closed.amount).toBe(0);
    expect(pendingBounties(data({ ledger: [opened(), closed] }), '2026-10-13')).toEqual([]);
  });
});

describe('current week', () => {
  it('shows points so far and how many are left to unlock the bounty', () => {
    const d = data({ ledger: [opened()], tasks: [task('2026-10-19', 'L'), task('2026-10-21', 'M')] });
    const w = currentWeek(d, '2026-10-21');
    expect(w.start).toBe('2026-10-19');
    expect(w.points).toBe(12);
    expect(w.toMinimum).toBe(18);
    expect(w.total).toBe(0);
  });
  it('knows the streak it would extend, even before this week qualifies', () => {
    const paid = bountyEntry('b', '2026-10-19T08:00:00.000Z', weekBounty('2026-10-12', 40, 1));
    const w = currentWeek(data({ ledger: [opened(), paid] }), '2026-10-21');
    expect(w.streakBefore).toBe(2);
    expect(w.streak).toBe(0);
  });
});

describe('ledger', () => {
  it('balance sums every movement; lifetime ignores spending', () => {
    const spent: LedgerEntry = { id: 's', key: 'spend:1', kind: 'weekly', amount: -150, label: 'x', at: '' };
    const l = [opened(), spent];
    expect(balance(l)).toBe(WELCOME_GIFT - 150);
    expect(lifetimeEarned(l)).toBe(WELCOME_GIFT);
    const sold: LedgerEntry = { id: 'x', key: 'sell:1', kind: 'sale', amount: 300, label: 'x', at: '' };
    expect(lifetimeEarned([...l, sold])).toBe(WELCOME_GIFT); // card sales are trading, not earnings
    expect(balance([...l, sold])).toBe(WELCOME_GIFT - 150 + 300);
  });
  it('loading data keeps only one entry per source key and drops malformed ones', () => {
    const d = normalize({
      version: 3,
      ledger: [opened(), { ...opened(), id: 'dup' }, { id: 'bad', key: 'x', amount: 'lots' }, { id: 'nokey', amount: 5 }],
    });
    expect(d.ledger.map((e) => e.id)).toEqual(['w']);
  });
  it('older data starts with an empty ledger', () => {
    expect(normalize({ version: 2, tasks: [] }).ledger).toEqual([]);
  });
});

describe('project reward', () => {
  const today = '2026-10-21';
  it('pays a flat 200 once one of its tasks is finished, whatever the points', () => {
    const tasks = [{ ...task('2026-10-06', 'S'), projectId: 'p' }, task('2026-10-07', 'XXL')];
    expect(projectReward({ id: 'p' }, tasks, [], today)).toEqual({ points: 2, amount: 200, capped: false });
  });
  it('pays nothing without a finished task', () => {
    const tasks = [{ ...task('2026-10-06', 'XL'), projectId: 'p', status: 'todo' as const }];
    expect(projectReward({ id: 'p' }, tasks, [], today)).toMatchObject({ amount: 0, capped: false });
  });
  it('only 3 projects pay per week (Mon–Sun); the next week starts fresh', () => {
    const tasks = [{ ...task('2026-10-20', 'S'), projectId: 'p' }];
    const paid = (id: string, day: string) => projectEntry(id, new Date(`${day}T12:00:00`).toISOString(), { id, title: id }, { points: 2, amount: 200 });
    const ledger = [paid('a', '2026-10-19'), paid('b', '2026-10-20'), paid('c', '2026-10-21')];
    expect(projectReward({ id: 'p' }, tasks, ledger, today)).toMatchObject({ amount: 0, capped: true });
    expect(projectReward({ id: 'p' }, tasks, ledger.slice(1), today).amount).toBe(200);
    expect(projectReward({ id: 'p' }, tasks, ledger, '2026-10-26').amount).toBe(200);
  });
});

describe('habits kept all week', () => {
  const habit = (id: string, frequency: 'daily' | 'weekly', target = 1, createdAt = '2026-10-01T08:00:00.000Z') =>
    ({ id, title: id, frequency, target, archived: false, createdAt, origin: null });
  const logs = (id: string, days: string[]) => days.map((date) => ({ id: `${id}${date}`, habitId: id, date }));
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  it('counts daily habits logged every day and weekly habits at their target', () => {
    const habits = [habit('a', 'daily'), habit('b', 'daily'), habit('c', 'weekly', 3), habit('d', 'weekly', 3)];
    const l = [...logs('a', week), ...logs('b', week.slice(1)), ...logs('c', week.slice(0, 3)), ...logs('d', week.slice(0, 2))];
    expect(habitsKept(habits, l, '2026-10-05')).toBe(2);
  });
  it('a habit created during the week starts counting next week', () => {
    expect(habitsKept([habit('a', 'daily', 1, '2026-10-07T08:00:00.000Z')], logs('a', week), '2026-10-05')).toBe(0);
  });
  it('the week in progress counts days so far', () => {
    expect(habitsKept([habit('a', 'daily')], logs('a', week.slice(0, 3)), '2026-10-05', '2026-10-07')).toBe(1);
  });
  it('each habit adds 25, even below the points minimum', () => {
    expect(weekBounty('2026-10-05', 10, 0, 2)).toMatchObject({ qualified: false, habitBonus: 50, total: 50 });
    expect(weekBounty('2026-10-05', 30, 0, 1).total).toBe(325);
  });
  it('a pending week pays its habits, and the bounty entry freezes them', () => {
    const d = data({ ledger: [opened()], tasks: [], habits: [habit('a', 'daily')], habitLogs: logs('a', week) });
    const [b] = pendingBounties(d, '2026-10-13');
    expect(b).toMatchObject({ habits: 1, total: 25 });
    const paid = bountyEntry('x', '2026-10-13T08:00:00.000Z', b);
    expect(paid.week?.habits).toBe(1);
    expect(paid.label).toContain('1 habit kept');
    expect(pendingBounties({ ...d, ledger: [opened(), paid], habitLogs: [] }, '2026-10-13')).toEqual([]);
  });
});

describe('milestone reward', () => {
  it('pays 50 only when a finished task is linked to it', () => {
    expect(milestoneReward({ id: 'm' }, [{ ...task('2026-10-06', 'XS'), milestoneId: 'm' }], [], '2026-10-21')).toBe(50);
    expect(milestoneReward({ id: 'm' }, [{ ...task('2026-10-06', 'XS'), milestoneId: 'm', status: 'doing' }], [], '2026-10-21')).toBe(0);
    expect(milestoneReward({ id: 'm' }, [], [], '2026-10-21')).toBe(0);
  });
  it('only 5 milestones pay per week', () => {
    const at = new Date('2026-10-20T12:00:00').toISOString();
    const ledger = Array.from({ length: 5 }, (_, i) => milestoneEntry(`m${i}`, at, { id: `m${i}`, title: 'x' }, 50));
    const done = [{ ...task('2026-10-20', 'XS'), milestoneId: 'm' }];
    expect(milestoneReward({ id: 'm' }, done, ledger, '2026-10-21')).toBe(0);
    expect(milestoneReward({ id: 'm' }, done, ledger, '2026-10-26')).toBe(50);
  });
});

describe('goal reward', () => {
  const goal = (reward: 'S' | 'M' | 'L' | 'XL' | null, setOn = '2026-07-01') =>
    ({ reward, rewardSetAt: reward ? new Date(`${setOn}T10:00:00`).toISOString() : null });
  it('pays the chosen tier once the goal is old enough', () => {
    expect(goalReward(goal('XL'), '2026-10-01')).toEqual({ tier: 'XL', amount: 3000, fullOn: null });
    expect(goalReward(goal('S'), '2026-07-01').amount).toBe(300);
  });
  it('a goal reached too soon pays the biggest tier its age allows', () => {
    expect(goalReward(goal('XL', '2026-10-01'), '2026-10-01')).toEqual({ tier: 'S', amount: 300, fullOn: '2026-12-30' });
    expect(goalReward(goal('XL', '2026-10-01'), '2026-10-10').tier).toBe('M');
    expect(goalReward(goal('L', '2026-10-01'), '2026-11-15').tier).toBe('L');
  });
  it('a goal without a tier pays nothing', () => {
    expect(goalReward(goal(null), '2026-10-01').amount).toBe(0);
  });
  it('loading data keeps valid tiers and drops unknown ones', () => {
    const d = normalize({ version: 3, goals: [{ id: 'a', reward: 'XL', rewardSetAt: '2026-01-01T00:00:00Z' }, { id: 'b', reward: 'HUGE', rewardSetAt: 'x' }, { id: 'c' }] });
    expect(d.goals.map((g) => [g.reward, g.rewardSetAt])).toEqual([['XL', '2026-01-01T00:00:00Z'], [null, null], [null, null]]);
  });
});

describe('in the room', () => {
  it('the chest fills with the balance but never overflows', () => {
    expect(chestCoins(0)).toBe(0);
    expect(chestCoins(-50)).toBe(0);
    expect(chestCoins(150)).toBe(11);
    expect(chestCoins(1500)).toBeGreaterThan(chestCoins(150));
    expect(chestCoins(10_000_000)).toBe(40);
  });
  it('the wanted poster shows lifetime earnings, not the balance', () => {
    const spent: LedgerEntry = { id: 's', key: 'buy:1', kind: 'purchase', amount: -3000, label: 'x', at: '' };
    const bounty: LedgerEntry = { id: 'b', key: 'week:x', kind: 'weekly', amount: 12_000, label: 'x', at: '' };
    expect(posterBounty([opened(), bounty, spent])).toBe('12,450');
  });
});

describe('earnings by source', () => {
  const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
  const entries: LedgerEntry[] = [
    { ...welcomeEntry('w', at('2026-10-05')) },
    bountyEntry('b1', at('2026-10-12'), weekBounty('2026-10-05', 40, 0, 2)), // 400 for points + 50 for habits
    projectEntry('p1', at('2026-10-14'), { id: 'p', title: 'P' }, { points: 4, amount: 200 }),
    { id: 's', key: 'sell:1', kind: 'sale', amount: 30, at: at('2026-10-15'), label: 'Sold' },
    { id: 'c', key: 'set:OP-01', kind: 'collection', amount: 1000, at: at('2026-10-20'), label: 'Set complete' },
    { id: 'x', key: 'buy:1', kind: 'purchase', amount: -150, at: at('2026-10-20'), label: 'Pack' },
  ];
  it('splits each week bounty into points and habits, and leaves out the gift, sales and spending', () => {
    const weeks = earningsByWeek(entries, '2026-10-21', 3);
    expect(weeks.map((w) => w.start)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    expect(weeks[1].by).toEqual({ weekly: 400, habits: 50, projects: 200, goals: 0, sets: 0 });
    expect(weeks[2]).toMatchObject({ total: 1000, by: { sets: 1000 } });
    expect(weeks[0].total).toBe(0);
  });
  it('totals every source, with sales on the side', () => {
    expect(earningTotals(entries)).toEqual({ by: { weekly: 400, habits: 50, projects: 200, goals: 0, sets: 1000 }, total: 1650, sales: 30 });
  });
});
