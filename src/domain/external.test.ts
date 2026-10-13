import { describe, expect, it } from 'vitest';
import { describeWhen, externalAgendaItems, localSpan } from './external';
import { agendaItems } from './services';
import { emptyData } from '../data/storage';
import type { CalendarFeed, ExternalEvent } from './types';

// The device zone decides which local day/time an instant falls on.
process.env.TZ = 'Europe/Paris';

const feed = (id: string, name = 'Work', color = '#4f7f9c'): CalendarFeed => ({ id, name, color, host: 'x', lastSyncAt: null, lastError: null, warnings: [], eventCount: 0 });
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
    expect(i).toMatchObject({ kind: 'external', title: 'Sync', color: '#c06c46', feedName: 'Team', refId: 'e1', date: '2026-06-10', time: '09:30' });
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
