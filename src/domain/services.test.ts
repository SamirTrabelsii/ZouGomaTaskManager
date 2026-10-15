import { describe, expect, it } from 'vitest';
import { consistency, dailyProgress, isActive, pointsBetween, readyToResume, sortTasks, pointsByDay, SIZE_POINTS, sumPoints, taskPoints, dueTone, goalProgress, plantGrowth, projectProgress, sortMilestones, streaks, weeklySummary } from './services';
import { emptyData, normalize } from '../data/storage';
import type { Habit, HabitLog, Task } from './types';

const habit = (o: Partial<Habit> = {}): Habit => ({
  id: 'h', title: 'Read', frequency: 'daily', target: 1, archived: false, createdAt: '2026-01-01T00:00:00', origin: null, ...o,
});
const logs = (...dates: string[]): HabitLog[] => dates.map((date, i) => ({ id: String(i), habitId: 'h', date }));
const task = (o: Partial<Task>): Task => ({
  id: Math.random().toString(), title: 't', notes: '', status: 'todo', priority: 'medium', size: null, dueDate: null,
  projectId: null, milestoneId: null, goalId: null, scopeId: null, blockedBy: '', resumeOn: null, createdAt: '2026-03-01T10:00:00', completedAt: null, ...o,
});

describe('habit streaks', () => {
  it('counts consecutive days ending today', () => {
    expect(streaks(habit(), logs('2026-03-08', '2026-03-09', '2026-03-10'), '2026-03-10').current).toBe(3);
  });
  it('does not break a streak just because today is not logged yet', () => {
    expect(streaks(habit(), logs('2026-03-08', '2026-03-09'), '2026-03-10').current).toBe(2);
  });
  it('resets after a real gap but remembers the best run', () => {
    const s = streaks(habit(), logs('2026-03-01', '2026-03-02', '2026-03-03', '2026-03-09'), '2026-03-10');
    expect(s.current).toBe(1);
    expect(s.best).toBe(3);
  });
  it('weekly habits count weeks that met their target', () => {
    const h = habit({ frequency: 'weekly', target: 2 });
    // weeks of 2026-03-02 and 2026-03-09 both have 2 logs
    const s = streaks(h, logs('2026-03-02', '2026-03-04', '2026-03-09', '2026-03-11'), '2026-03-12');
    expect(s.current).toBe(2);
  });
});

describe('plants never punish', () => {
  it('growth depends on lifetime logs and never shrinks when days are missed', () => {
    const l = logs(...Array.from({ length: 10 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`));
    const early = plantGrowth(habit(), l, '2026-02-11');
    const late = plantGrowth(habit(), l, '2026-06-01'); // months of nothing
    expect(late.size).toBe(early.size);
    expect(late.stage).toBe(early.stage);
    expect(late.vigor).toBeGreaterThanOrEqual(0.7);
  });
  it('a new habit has a seed, not a dead plant', () => {
    expect(plantGrowth(habit(), [], '2026-03-10').stage).toBe(0);
  });
  it('consistency is capped at 100%', () => {
    const all = logs(...Array.from({ length: 40 }, (_, i) => new Date(2026, 1, 1 + i).toISOString().slice(0, 10)));
    expect(consistency(habit(), all, '2026-03-10')).toBeLessThanOrEqual(1);
  });
});

describe('progress', () => {
  it('daily progress counts what was finished today plus what is still due', () => {
    const today = '2026-03-10';
    const tasks = [
      task({ status: 'done', completedAt: new Date(2026, 2, 10, 9).toISOString() }),
      task({ dueDate: today }),
      task({ dueDate: '2026-03-01' }),
      task({ dueDate: '2026-03-20' }),
    ];
    const p = dailyProgress(tasks, today);
    expect([p.done, p.remaining, p.total]).toEqual([1, 2, 3]);
  });
  it('project progress combines tasks and milestones', () => {
    const p = { id: 'p', title: 'P', description: '', status: 'active' as const, deadline: null, createdAt: '' };
    const r = projectProgress(
      p,
      [task({ projectId: 'p', status: 'done' }), task({ projectId: 'p' })],
      [{ id: 'm', projectId: 'p', title: 'm', dueDate: null, done: true, completedAt: '' }, { id: 'm2', projectId: 'p', title: 'm', dueDate: null, done: false, completedAt: null }],
    );
    expect(r.ratio).toBe(0.5);
  });
  it('goal progress is clamped', () => {
    expect(goalProgress({ id: 'g', title: '', description: '', unit: '', target: 10, current: 25, deadline: null, createdAt: '' })).toBe(1);
  });
  it('weekly summary only counts the given week', () => {
    const d = emptyData();
    d.tasks = [task({ status: 'done', completedAt: new Date(2026, 2, 10).toISOString() }), task({ status: 'done', completedAt: new Date(2026, 1, 1).toISOString() })];
    expect(weeklySummary(d, '2026-03-09').tasksCompleted).toBe(1);
  });
});

describe('data normalisation', () => {
  it('round-trips empty data', () => {
    expect(normalize(JSON.parse(JSON.stringify(emptyData()))).tasks).toEqual([]);
  });
  it('rejects non-LifeOS payloads and newer versions', () => {
    expect(() => normalize({ hello: 1 })).toThrow();
    expect(() => normalize({ version: 99 })).toThrow();
    expect(() => normalize(null)).toThrow();
  });
  it('drops malformed rows instead of crashing', () => {
    const d = normalize({ version: 1, tasks: [{ id: 'a', title: 'ok' }, { nope: true }, 5] });
    expect(d.tasks).toHaveLength(1);
  });
});

describe('due tones', () => {
  const today = '2026-03-10';
  it('colours open tasks by how their date relates to today', () => {
    expect(dueTone(task({ dueDate: '2026-03-09' }), today)).toBe('overdue');
    expect(dueTone(task({ dueDate: today }), today)).toBe('today');
    expect(dueTone(task({ dueDate: '2026-03-17' }), today)).toBe('soon');
    expect(dueTone(task({ dueDate: '2026-03-18' }), today)).toBe('later');
  });
  it('still flags blocked and on-hold tasks, but never finished or undated ones', () => {
    expect(dueTone(task({ status: 'blocked', dueDate: '2026-03-01' }), today)).toBe('overdue');
    expect(dueTone(task({ status: 'done', dueDate: '2026-03-01' }), today)).toBeNull();
    expect(dueTone(task({}), today)).toBeNull();
  });
});

describe('task statuses and scopes', () => {
  it('leaves on-hold tasks out of the daily progress', () => {
    const p = dailyProgress([task({ dueDate: '2026-03-10' }), task({ status: 'onhold', dueDate: '2026-03-10' }), task({ status: 'blocked', dueDate: '2026-03-10' })], '2026-03-10');
    expect(p.remaining).toBe(2);
  });
  it('migrates old data: scopes are optional and dangling or legacy fields are dropped', () => {
    const raw = {
      ...emptyData(),
      scopes: [{ id: 'sc', title: 'Work', icon: 5, color: 'nope' }, { id: 'x' }],
      tasks: [
        { id: 'a', title: 'A', status: 'todo' },
        { id: 'b', title: 'B', status: 'weird', scopeId: 'sc', parentId: 'a' },
        { id: 'c', title: 'C', status: 'todo', scopeId: 'gone' },
      ],
    };
    const d = normalize(raw);
    const t = Object.fromEntries(d.tasks.map((x) => [x.id, x]));
    expect(d.scopes).toEqual([{ id: 'sc', title: 'Work', icon: '📁', color: '#62b4ff' }]);
    expect(t.a.scopeId).toBeNull();
    expect(t.b.scopeId).toBe('sc');
    expect(t.b.status).toBe('todo');
    expect('parentId' in t.b).toBe(false);
    expect(t.c.scopeId).toBeNull();
  });
});

describe('story points', () => {
  it('maps each size to its points', () => {
    expect(SIZE_POINTS).toEqual({ XS: 1, S: 2, M: 4, L: 8, XL: 16, XXL: 32 });
    expect(taskPoints(task({ size: 'L' }))).toBe(8);
    expect(taskPoints(task({ size: null }))).toBe(0);
  });
  it('sums points and counts them on the day a task was finished', () => {
    const day = new Date(2026, 2, 10, 9).toISOString();
    const ts = [task({ size: 'M', status: 'done', completedAt: day }), task({ size: 'XL', status: 'done', completedAt: day }), task({ size: 'S' })];
    expect(sumPoints(ts)).toBe(22);
    expect(pointsByDay(ts, '2026-03-10', 2).map((d) => d.points)).toEqual([0, 20]);
  });
  it('migration keeps valid sizes, turns the retired HUGE into XXL and clears unknown ones', () => {
    const d = normalize({ ...emptyData(), tasks: [{ id: 'a', title: 'A', size: 'XXL' }, { id: 'b', title: 'B', size: 'giant' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D', size: 'HUGE' }] });
    expect(d.tasks.map((t) => t.size)).toEqual(['XXL', null, null, 'XXL']);
  });
});

describe('data version', () => {
  it('upgrades v1 data and refuses data from a newer app', () => {
    expect(normalize({ version: 1, tasks: [{ id: 'a', title: 'A' }] }).version).toBe(2);
    expect(() => normalize({ version: 3, tasks: [] })).toThrow(/newer LifeOS/);
  });
});

describe('points per period', () => {
  it('sums points finished within a date range and reports them in the weekly summary', () => {
    const at = (d: number) => new Date(2026, 2, d, 12).toISOString();
    const ts = [task({ size: 'M', status: 'done', completedAt: at(9) }), task({ size: 'L', status: 'done', completedAt: at(11) }), task({ size: 'XL', status: 'done', completedAt: at(20) })];
    expect(pointsBetween(ts, '2026-03-09', '2026-03-15')).toBe(12);
    const d = { ...emptyData(), tasks: ts };
    expect(weeklySummary(d, '2026-03-09').pointsCompleted).toBe(12);
  });
});

describe('parked and blocked tasks', () => {
  it('on-hold and finished tasks are not active', () => {
    expect(isActive(task({ status: 'doing' }))).toBe(true);
    expect(isActive(task({ status: 'blocked' }))).toBe(true);
    expect(isActive(task({ status: 'onhold' }))).toBe(false);
    expect(isActive(task({ status: 'done' }))).toBe(false);
  });
  it('lists on-hold tasks whose resume date has come', () => {
    const ts = [
      task({ id: 'due', status: 'onhold', resumeOn: '2026-03-10' }),
      task({ id: 'past', status: 'onhold', resumeOn: '2026-03-01' }),
      task({ id: 'later', status: 'onhold', resumeOn: '2026-03-11' }),
      task({ id: 'nodate', status: 'onhold' }),
      task({ id: 'todo', status: 'todo', resumeOn: '2026-03-01' }),
    ];
    expect(readyToResume(ts, '2026-03-10').map((t) => t.id).sort()).toEqual(['due', 'past']);
  });
  it('sorts by size, largest first, unsized last', () => {
    const ts = [task({ id: 'n' }), task({ id: 's', size: 'S' }), task({ id: 'x', size: 'XL' })];
    expect(sortTasks(ts, 'size').map((t) => t.id)).toEqual(['x', 's', 'n']);
  });
  it('sorts milestones by due date, undated last in insertion order', () => {
    const m = (id: string, dueDate: string | null) => ({ id, projectId: 'p', title: id, dueDate, done: false, completedAt: null });
    const ms = [m('next-month', '2026-04-10'), m('none-a', null), m('next-week', '2026-03-17'), m('none-b', null)];
    expect(sortMilestones(ms).map((x) => x.id)).toEqual(['next-week', 'next-month', 'none-a', 'none-b']);
  });
  it('keeps the blocked note and resume date only for their own status when loading', () => {
    const d = normalize({
      ...emptyData(),
      tasks: [
        { id: 'a', title: 'A', status: 'blocked', blockedBy: 'legal' },
        { id: 'b', title: 'B', status: 'todo', blockedBy: 'stale', resumeOn: '2026-04-01' },
        { id: 'c', title: 'C', status: 'onhold', resumeOn: '2026-04-01' },
        { id: 'd', title: 'D', status: 'onhold', resumeOn: 'soon' },
      ],
    });
    const t = Object.fromEntries(d.tasks.map((x) => [x.id, x]));
    expect([t.a.blockedBy, t.b.blockedBy, t.b.resumeOn, t.c.resumeOn, t.d.resumeOn]).toEqual(['legal', '', null, '2026-04-01', null]);
  });
});
