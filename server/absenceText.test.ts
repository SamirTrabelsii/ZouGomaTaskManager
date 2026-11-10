import { describe, expect, it } from 'vitest';
import { absenceMails, awayWindows, cleanDays, dayCount, describeDays, mailHtml, planningCells, planningReady, type AbsenceDay, type DayPart } from './absenceText';

const d = (date: string, part: DayPart = 'full'): AbsenceDay => ({ date, part });
const say = (...days: AbsenceDay[]) => describeDays(cleanDays(days) as AbsenceDay[]);

describe('absence wording', () => {
  it('one day and half days', () => {
    expect(say(d('2026-11-06'))).toBe('le vendredi 06 novembre 2026');
    expect(say(d('2026-11-19', 'am'))).toBe('le jeudi 19 novembre 2026 matin');
    expect(say(d('2026-11-19', 'pm'))).toBe('le jeudi 19 novembre 2026 après-midi');
  });
  it('ranges, also over a weekend and across months or years', () => {
    expect(say(d('2026-11-09'), d('2026-11-10'), d('2026-11-11'))).toBe('du lundi 09 au mercredi 11 novembre 2026');
    expect(say(d('2026-11-13'), d('2026-11-16'))).toBe('du vendredi 13 au lundi 16 novembre 2026');
    expect(say(d('2026-11-30'), d('2026-12-01'))).toBe('du lundi 30 novembre au mardi 01 décembre 2026');
    expect(say(d('2026-12-31'), d('2027-01-01'))).toBe('du jeudi 31 décembre 2026 au vendredi 01 janvier 2027');
  });
  it('separate days', () => {
    expect(say(d('2026-11-09'), d('2026-11-11'))).toBe('les lundi 09 et mercredi 11 novembre 2026');
    expect(say(d('2026-11-13'), d('2026-11-09'), d('2026-11-11'))).toBe('les lundi 09, mercredi 11 et vendredi 13 novembre 2026');
    expect(say(d('2026-11-27'), d('2026-12-01'))).toBe('les vendredi 27 novembre et mardi 01 décembre 2026');
  });
  it('mixes', () => {
    expect(say(d('2026-11-10', 'pm'), d('2026-11-12'), d('2026-11-13')))
      .toBe('le mardi 10 novembre 2026 après-midi et du jeudi 12 au vendredi 13 novembre 2026');
    expect(say(d('2026-11-12'), d('2026-11-13', 'am'))).toBe('le jeudi 12 novembre 2026 et le vendredi 13 novembre 2026 matin');
  });
  it('counts half days as halves', () => {
    expect(dayCount([d('2026-11-12'), d('2026-11-13', 'am')])).toBe(1.5);
  });
});

describe('absence days input', () => {
  it('sorts and refuses bad input', () => {
    expect(cleanDays([d('2026-11-13'), d('2026-11-09', 'am')])).toEqual([d('2026-11-09', 'am'), d('2026-11-13')]);
    expect(cleanDays([])).toMatch(/at least/);
    expect(cleanDays([d('2026-02-30')])).toMatch(/real day/);
    expect(cleanDays([{ date: '2026-11-09', part: 'night' }])).toMatch(/morning/);
    expect(cleanDays([d('2026-11-09'), d('2026-11-09', 'am')])).toMatch(/twice/);
    expect(cleanDays('2026-11-09')).toMatch(/at least/);
  });
});

describe('away windows', () => {
  it('turns days into wall-clock windows', () => {
    expect(awayWindows([d('2026-11-13')])).toEqual([{ start: '2026-11-13T00:00', end: '2026-11-14T00:00' }]);
    expect(awayWindows([d('2026-11-13', 'am')])).toEqual([{ start: '2026-11-13T00:00', end: '2026-11-13T13:00' }]);
    expect(awayWindows([d('2026-11-13', 'pm')])).toEqual([{ start: '2026-11-13T13:00', end: '2026-11-14T00:00' }]);
  });
  it('joins what touches, and what only a weekend separates', () => {
    expect(awayWindows([d('2026-11-12', 'pm'), d('2026-11-13')])).toEqual([{ start: '2026-11-12T13:00', end: '2026-11-14T00:00' }]);
    expect(awayWindows([d('2026-11-13', 'pm'), d('2026-11-16', 'am')])).toEqual([{ start: '2026-11-13T13:00', end: '2026-11-16T13:00' }]);
    expect(awayWindows([d('2026-11-13'), d('2026-11-16')])).toEqual([{ start: '2026-11-13T00:00', end: '2026-11-17T00:00' }]);
  });
  it('keeps separate days apart', () => {
    expect(awayWindows([d('2026-11-09'), d('2026-11-11')])).toEqual([
      { start: '2026-11-09T00:00', end: '2026-11-10T00:00' }, { start: '2026-11-11T00:00', end: '2026-11-12T00:00' }]);
    expect(awayWindows([d('2026-11-12', 'am'), d('2026-11-13', 'pm')])).toHaveLength(2);
  });
});

describe('absence mails', () => {
  const settings = { employer: { to: ['boss@employer.test'], cc: ['hr@employer.test'] }, client: { to: ['lead@client.test'], cc: [] }, planningName: 'Me' };
  const [employer, client] = absenceMails([d('2026-11-06')], settings);
  it('matches the owner’s templates', () => {
    expect(employer).toMatchObject({ via: 'outlook', to: ['boss@employer.test'], cc: ['hr@employer.test'], subject: 'Absence du bureau' });
    expect(employer.lines.join('\n')).toBe(
      "Bonjour,\nJ'espère que tu vas bien.\nJe voulais t'informer que je serai absent du bureau le vendredi 06 novembre 2026.\nJe te remercie par avance de bien vouloir prendre en compte ma demande.\nCordialement,");
    expect(client).toMatchObject({ via: 'gmail', to: ['lead@client.test'] });
    expect(client.lines.join('\n')).toBe('Bonjour,\n\nJ’espère que tu vas bien.\n\nJe souhaite t’informer que je serai absent du bureau le vendredi 06 novembre 2026.\n\nCordialement,');
  });
  it('renders escaped HTML', () => {
    expect(mailHtml({ ...client, lines: ['a < b', ''] })).toBe('<div>a &lt; b</div><div><br></div>');
  });
  it('writes only whole weekdays to the planning', () => {
    expect(planningCells([d('2026-11-12', 'am'), d('2026-11-13'), d('2026-11-14')])).toEqual([{ date: '2026-11-13', value: 'Absent' }]);
  });
});

describe('planning timing', () => {
  const cells = (...dates: string[]) => dates.map((date) => ({ date }));
  it('waits until the week is this week or next week in the workbook', () => {
    expect(planningReady(cells('2026-11-20'), '2026-11-10')).toBe(true);      // next week
    expect(planningReady(cells('2026-11-11'), '2026-11-10')).toBe(true);      // this week
    expect(planningReady(cells('2026-11-23'), '2026-11-16')).toBe(true);      // Monday 16: the 23rd is next week
    expect(planningReady(cells('2026-11-23'), '2026-11-15')).toBe(false);     // Sunday 15 still belongs to the week of the 9th
    expect(planningReady(cells('2026-11-23'), '2026-11-13')).toBe(false);     // two weeks ahead
    expect(planningReady(cells('2026-12-18', '2026-11-30'), '2026-11-23')).toBe(true); // the first cell decides
  });
  it('lets a step with no cell through', () => {
    expect(planningReady([], '2026-11-10')).toBe(true);
  });
});
