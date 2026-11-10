import { describe, expect, it } from 'vitest';
import { absenceBotMood, absenceSummary, addRange, cycleDay, defaultSteps, monthGrid, upcomingDays, type Absence, type AbsenceList } from './absence';

describe('picking days', () => {
  it('cycles a day through whole, morning, afternoon, off', () => {
    let days = cycleDay([], '2026-11-13');
    expect(days).toEqual([{ date: '2026-11-13', part: 'full' }]);
    days = cycleDay(days, '2026-11-13'); expect(days[0].part).toBe('am');
    days = cycleDay(days, '2026-11-13'); expect(days[0].part).toBe('pm');
    expect(cycleDay(days, '2026-11-13')).toEqual([]);
  });
  it('adds a range of weekdays, in either order, over what is picked', () => {
    const days = addRange([{ date: '2026-11-12', part: 'am' }], '2026-11-17', '2026-11-12');
    expect(days.map((d) => `${d.date}:${d.part}`)).toEqual(['2026-11-12:full', '2026-11-13:full', '2026-11-16:full', '2026-11-17:full']);
  });
  it('lays a month out from Monday', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[weeks.length - 1][0]).toBe('2026-11-30');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

const absence = (over: Partial<Absence>): Absence => ({
  id: '1', days: [{ date: '2026-11-13', part: 'full' }], label: 'le vendredi 13 novembre 2026', cancelled: false, createdAt: '', steps: [], ...over,
});
const listOf = (absences: Absence[], online = true, kinds: AbsenceList['executor']['kinds'] = []): AbsenceList =>
  ({ absences, executor: { online, lastSeenAt: null, kinds }, executors: [] });
const step = (status: 'pending' | 'running' | 'done' | 'failed') => ({ id: status, kind: 'mail_employer' as const, status, detail: '', finishedAt: null });

describe('the absence robot', () => {
  it('worries about a failure before anything else', () => {
    expect(absenceBotMood(listOf([absence({ steps: [step('failed'), step('running')] })]), '2026-11-10')).toBe('worried');
  });
  it('is busy when work runs or an executor listens, waiting when nobody does', () => {
    expect(absenceBotMood(listOf([absence({ steps: [step('pending')] })], true), '2026-11-10')).toBe('busy');
    expect(absenceBotMood(listOf([absence({ steps: [step('pending')] })], false), '2026-11-10')).toBe('waiting');
    expect(absenceBotMood(listOf([absence({ steps: [step('running')] })], false), '2026-11-10')).toBe('busy');
  });
  it('knows when the owner is away today, and ignores cancelled absences', () => {
    expect(absenceBotMood(listOf([absence({ steps: [step('done')] })]), '2026-11-13')).toBe('away');
    expect(absenceBotMood(listOf([absence({ cancelled: true, steps: [step('failed')] })]), '2026-11-13')).toBe('idle');
  });
  it('shows the next day off', () => {
    const list = listOf([absence({ days: [{ date: '2026-11-09', part: 'full' }, { date: '2026-11-20', part: 'am' }], steps: [step('done')] })]);
    expect(upcomingDays(list.absences, '2026-11-10')[0].date).toBe('2026-11-20');
    expect(absenceSummary(list, '2026-11-10').summary).toBe('Next absence: 2026-11-20');
    expect(absenceSummary(listOf([]), '2026-11-10').prompt).toBe('Book a day off');
  });
  it('ticks by default what the executor runs, else everything but Boond', () => {
    expect(defaultSteps(null)).not.toContain('boond_cra');
    expect(defaultSteps({ online: true, lastSeenAt: null, kinds: ['mail_employer'] })).toEqual(['mail_employer']);
  });
});
