import { describe, expect, it } from 'vitest';
import { isNightLook, relativeDay } from './dates';

describe('isNightLook', () => {
  it('auto follows the clock: night 19:00–05:59, day otherwise', () => {
    for (const h of [19, 22, 23, 0, 3, 5]) expect(isNightLook('auto', h), `hour ${h}`).toBe(true);
    for (const h of [6, 9, 12, 15, 18]) expect(isNightLook('auto', h), `hour ${h}`).toBe(false);
  });
  it('explicit themes ignore the clock', () => {
    expect(isNightLook('evening', 12)).toBe(true);
    expect(isNightLook('day', 23)).toBe(false);
  });
});

describe('relativeDay', () => {
  it('uses English day names, in full or as three letters', () => {
    expect(relativeDay('2026-03-12', '2026-03-10')).toBe('Thursday');
    expect(relativeDay('2026-03-12', '2026-03-10', true)).toBe('Thu');
    expect(relativeDay('2026-03-11', '2026-03-10', true)).toBe('Tomorrow');
    expect(relativeDay('2026-03-08', '2026-03-10', true)).toBe('2 days overdue');
  });
});
