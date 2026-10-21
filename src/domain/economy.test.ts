import { describe, expect, it } from 'vitest';
import {
  balance, bountyEntry, currentWeek, economyStart, lifetimeEarned, pendingBounties, streakMultiplier, weekBounty,
  welcomeEntry, WELCOME_GIFT,
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
