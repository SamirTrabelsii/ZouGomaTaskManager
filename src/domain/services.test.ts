import { describe, expect, it } from 'vitest';
import { consistency, dailyProgress, dueTone, goalProgress, plantGrowth, projectProgress, streaks, subtaskProgress, weeklySummary } from './services';
import { emptyData, normalize } from '../data/storage';
import type { Habit, HabitLog, Task } from './types';

const habit = (o: Partial<Habit> = {}): Habit => ({
  id: 'h', title: 'Read', frequency: 'daily', target: 1, archived: false, createdAt: '2026-01-01T00:00:00', origin: null, ...o,
});
const logs = (...dates: string[]): HabitLog[] => dates.map((date, i) => ({ id: String(i), habitId: 'h', date }));
const task = (o: Partial<Task>): Task => ({
  id: Math.random().toString(), title: 't', notes: '', status: 'todo', priority: 'medium', dueDate: null,
  projectId: null, milestoneId: null, goalId: null, parentId: null, createdAt: '2026-03-01T10:00:00', completedAt: null, ...o,
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

describe('task statuses and subtasks', () => {
  it('leaves on-hold tasks out of the daily progress', () => {
    const p = dailyProgress([task({ dueDate: '2026-03-10' }), task({ status: 'onhold', dueDate: '2026-03-10' }), task({ status: 'blocked', dueDate: '2026-03-10' })], '2026-03-10');
    expect(p.remaining).toBe(2);
  });
  it('counts finished subtasks of a parent', () => {
    const ts = [task({ id: 'a' }), task({ parentId: 'a', status: 'done' }), task({ parentId: 'a' }), task({ parentId: 'other' })];
    expect(subtaskProgress(ts, 'a')).toEqual({ done: 1, total: 2 });
  });
  it('migrates old data and drops invalid parents', () => {
    const raw = {
      ...emptyData(),
      tasks: [
        { id: 'p', title: 'P', status: 'todo' },
        { id: 'c', title: 'C', status: 'weird', parentId: 'p' },
        { id: 'gc', title: 'GC', status: 'todo', parentId: 'c' }, // nested – not allowed
        { id: 'o', title: 'O', status: 'todo', parentId: 'missing' },
        { id: 's', title: 'S', status: 'todo', parentId: 's' },
      ],
    };
    const t = Object.fromEntries(normalize(raw).tasks.map((x) => [x.id, x]));
    expect(t.p.parentId).toBeNull();
    expect(t.c.parentId).toBe('p');
    expect(t.c.status).toBe('todo');
    expect(t.gc.parentId).toBeNull();
    expect(t.o.parentId).toBeNull();
    expect(t.s.parentId).toBeNull();
  });
});
