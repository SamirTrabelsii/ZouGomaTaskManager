import { describe, expect, it } from 'vitest';
import { describeSpan, describeWhen, externalAgendaItems, localSpan } from './external';
import { agendaItems, nextUp } from './services';
import { emptyData } from '../data/storage';
import type { CalendarFeed, ExternalEvent } from './types';

// The device zone decides which local day/time an instant falls on.
process.env.TZ = 'Europe/Paris';

const feed = (id: string, name = 'Work', color = '#4f7f9c'): CalendarFeed => ({ id, name, color, host: 'x', lastSyncAt: null, lastError: null, warnings: [], eventCount: 0, remindBefore: null });
const ev = (over: Partial<ExternalEvent>): ExternalEvent => ({ id: 'e1', feedId: '1', title: 'Sync', location: '', description: '', allDay: false, start: '2026-06-10T07:30:00Z', end: '2026-06-10T08:30:00Z', ...over });

describe('time zones on this device', () => {
  it('runs these tests in Paris time', () => {
    expect(new Date('2026-06-10T07:30:00Z').getHours()).toBe(9); // guards the TZ override itself
  });
  it('shows an instant in local time (summer +2, winter +1)', () => {
    expect(localSpan(ev({}))).toMatchObject({ startDay: '2026-06-10', startTime: '09:30', endTime: '10:30' });
    expect(localSpan(ev({ start: '2026-12-10T08:30:00Z', end: '2026-12-10T09:30:00Z' }))).toMatchObject({ startTime: '09:30', endTime: '10:30' });
  });
  it('moves a late-evening UTC meeting onto the next local day', () => {
    expect(localSpan(ev({ start: '2026-06-10T22:30:00Z', end: '2026-06-10T23:30:00Z' }))).toMatchObject({ startDay: '2026-06-11', lastDay: '2026-06-11', startTime: '00:30' });
  });
  it('takes floating times as written', () => {
    expect(localSpan(ev({ start: '2026-06-10T09:30:00', end: '2026-06-10T10:30:00' }))).toMatchObject({ startDay: '2026-06-10', startTime: '09:30', endTime: '10:30' });
  });
});

describe('spans', () => {
  it('treats an all-day end as exclusive', () => {
    expect(localSpan(ev({ allDay: true, start: '2026-06-10', end: '2026-06-13' }))).toMatchObject({ startDay: '2026-06-10', lastDay: '2026-06-12', startTime: null });
    expect(localSpan(ev({ allDay: true, start: '2026-06-10', end: '2026-06-11' }))).toMatchObject({ lastDay: '2026-06-10' });
  });
  it('does not spill a meeting ending at midnight onto the next day', () => {
    expect(localSpan(ev({ start: '2026-06-10T20:00:00Z', end: '2026-06-10T22:00:00Z' }))).toMatchObject({ startDay: '2026-06-10', lastDay: '2026-06-10' }); // 22:00Z = 00:00 Paris
  });
  it('lays a multi-day timed meeting over each day it touches', () => {
    const items = externalAgendaItems([ev({ start: '2026-06-10T15:00:00Z', end: '2026-06-12T10:00:00Z' })], [feed('1')]);
    expect(items.map((i) => [i.date, i.time])).toEqual([['2026-06-10', '17:00'], ['2026-06-11', null], ['2026-06-12', null]]);
  });
  it('survives a missing or broken end and a broken start', () => {
    expect(localSpan(ev({ end: 'garbage' }))).toMatchObject({ startDay: '2026-06-10', endTime: null });
    expect(localSpan(ev({ start: 'garbage' }))).toBeNull();
    expect(externalAgendaItems([ev({ start: 'garbage' })], [feed('1')])).toEqual([]);
  });
  it('caps an absurdly long all-day span', () => {
    expect(externalAgendaItems([ev({ allDay: true, start: '2026-01-01', end: '2030-01-01' })], [feed('1')]).length).toBe(31);
  });
});

describe('agenda items', () => {
  it('carry the calendar colour and name, and are marked as imported', () => {
    const [i] = externalAgendaItems([ev({})], [feed('1', 'Team', '#c06c46')]);
    expect(i).toMatchObject({ kind: 'external', title: 'Sync', color: '#c06c46', feedName: 'Team', refId: 'e1', date: '2026-06-10', time: '09:30', endTime: '10:30' });
  });
  it('give each day of a multi-day meeting its own key', () => {
    const keys = externalAgendaItems([ev({ allDay: true, start: '2026-06-10', end: '2026-06-13' })], [feed('1')]).map((i) => i.key);
    expect(new Set(keys).size).toBe(3);
  });
  it('skip meetings whose calendar was removed', () => {
    expect(externalAgendaItems([ev({ feedId: '9' })], [feed('1')])).toEqual([]);
  });
  it('merge with the user\'s own items in time order without altering them', () => {
    const d = emptyData();
    d.events = [{ id: 'mine', title: 'My event', kind: 'event', date: '2026-06-10', time: '08:00', endTime: null, notes: '', remindBefore: null }];
    const items = agendaItems(d, externalAgendaItems([ev({}), ev({ id: 'e2', title: 'All day', allDay: true, start: '2026-06-10', end: '2026-06-11' })], [feed('1')]));
    expect(items.map((i) => `${i.kind}:${i.title}`)).toEqual(['external:All day', 'event:My event', 'external:Sync']);
    expect(d.events).toHaveLength(1); // the user's own data is untouched
    expect(agendaItems(d).map((i) => i.kind)).toEqual(['event']); // and works with no feeds at all
  });
});

describe('describeWhen', () => {
  const day = (d: string) => d;
  const time = (t: string | null) => t ?? '';
  it('reads naturally', () => {
    expect(describeWhen(ev({}), day, time)).toBe('2026-06-10 · 09:30 – 10:30');
    expect(describeWhen(ev({ allDay: true, start: '2026-06-10', end: '2026-06-11' }), day, time)).toBe('2026-06-10 · all day');
    expect(describeWhen(ev({ allDay: true, start: '2026-06-10', end: '2026-06-13' }), day, time)).toBe('2026-06-10 – 2026-06-12 · all day');
  });
});

describe('nextUp (the "next event" shown in the overview and on the room hover card)', () => {
  const NOW = new Date('2026-06-10T08:00:00Z'); // 10:00 in Paris
  const own = (id: string, time: string | null, endTime: string | null = null, date = '2026-06-10') =>
    ({ id, title: `Mine ${id}`, kind: 'event' as const, date, time, endTime, notes: '', remindBefore: null });
  const imported = (...evs: Partial<ExternalEvent>[]) => externalAgendaItems(evs.map((e, i) => ev({ id: `x${i}`, ...e })), [feed('1', 'Work', '#c06c46')]);
  const at = (hhmmUtc: string, mins = 60) => {
    const start = new Date(`2026-06-10T${hhmmUtc}:00Z`);
    return { start: start.toISOString(), end: new Date(start.getTime() + mins * 60_000).toISOString() };
  };

  it('picks an imported meeting that is earlier than your own next event, with its colour', () => {
    const n = nextUp([own('a', '16:00')], imported({ title: 'Standup', ...at('10:00') }), NOW);
    expect(n).toMatchObject({ title: 'Standup', date: '2026-06-10', time: '12:00', color: '#c06c46' });
  });
  it('picks your own event when it comes first', () => {
    const n = nextUp([own('a', '11:00')], imported({ title: 'Standup', ...at('10:00') }), NOW);
    expect(n).toMatchObject({ title: 'Mine a', time: '11:00' });
    expect(n?.color).toBeUndefined();
  });
  it('still counts a meeting that is in progress, and ignores one that has ended', () => {
    expect(nextUp([], imported({ title: 'Running', ...at('07:30', 90) }), NOW)?.title).toBe('Running'); // 09:30–11:00 Paris
    expect(nextUp([], imported({ title: 'Over', ...at('06:00') }, { id: 'later', title: 'Later', ...at('13:00') }), NOW)?.title).toBe('Later');
  });
  it('never lets an imported all-day entry (holiday, out of office) hide a real meeting', () => {
    const items = imported({ title: 'Holiday', allDay: true, start: '2026-06-10', end: '2026-06-12' }, { title: 'Standup', ...at('10:00') });
    expect(nextUp([], items, NOW)?.title).toBe('Standup');
    expect(nextUp([], imported({ title: 'Holiday', allDay: true, start: '2026-06-10', end: '2026-06-12' }), NOW)).toBeNull();
  });
  it('uses imported meetings on later days and returns null when there is nothing', () => {
    expect(nextUp([], imported({ title: 'Tomorrow', start: '2026-06-11T07:00:00Z', end: '2026-06-11T08:00:00Z' }), NOW)).toMatchObject({ title: 'Tomorrow', date: '2026-06-11', time: '09:00' });
    expect(nextUp([], [], NOW)).toBeNull();
  });
  it('keeps the old behaviour for your own events alone', () => {
    expect(nextUp([own('a', '09:00', '09:30'), own('b', '15:00')], [], NOW)).toMatchObject({ title: 'Mine b' });
  });
});

describe('describeSpan', () => {
  const day = (d: string) => d;
  const time = (t: string | null) => t ?? '';
  const items = (e: ExternalEvent) => externalAgendaItems([e], [feed('1')]);

  it('shows the time range of a single-day meeting', () => {
    expect(describeSpan(items(ev({}))[0], day, time)).toBe('09:30 – 10:30');
  });
  it('shows start and end dates with times when a meeting spans days', () => {
    const [first, second] = items(ev({ start: '2026-06-10T20:00:00Z', end: '2026-06-11T08:00:00Z' }));
    const line = '2026-06-10, 22:00 → 2026-06-11, 10:00';
    expect(describeSpan(first, day, time)).toBe(line);
    expect(describeSpan(second, day, time)).toBe(line);
  });
  it('shows only dates for multi-day all-day events', () => {
    const [first] = items(ev({ allDay: true, start: '2026-06-10', end: '2026-06-13' }));
    expect(describeSpan(first, day, time)).toBe('2026-06-10 → 2026-06-12');
  });
  it('is empty when there is nothing to add', () => {
    expect(describeSpan(items(ev({ allDay: true, start: '2026-06-10', end: '2026-06-11' }))[0], day, time)).toBe('');
  });
});
