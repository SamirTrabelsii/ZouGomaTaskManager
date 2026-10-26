import { describe, expect, it } from 'vitest';
import { holoPattern, REVEAL_TIMING, revealTier } from './reveal';

describe('reveal tiers', () => {
  it('rank prints from common to chase', () => {
    expect(revealTier({ rarity: 'C', variant: 'base' })).toBe('common');
    expect(revealTier({ rarity: 'UC', variant: 'base' })).toBe('common');
    expect(revealTier({ rarity: 'R', variant: 'base' })).toBe('rare');
    expect(revealTier({ rarity: 'L', variant: 'base' })).toBe('super');
    expect(revealTier({ rarity: 'UC', variant: 'foil' })).toBe('super');
    expect(revealTier({ rarity: 'SEC', variant: 'base' })).toBe('secret');
    expect(revealTier({ rarity: 'TR', variant: 'base' })).toBe('secret');
    for (const variant of ['parallel', 'superParallel', 'sp', 'manga', 'tr', 'special'] as const) {
      expect(revealTier({ rarity: 'R', variant })).toBe('chase');
    }
  });
  it('picks a holo pattern per print', () => {
    expect(holoPattern({ rarity: 'C', variant: 'base' })).toBe('none');
    expect(holoPattern({ rarity: 'SR', variant: 'base' })).toBe('soft');
    expect(holoPattern({ rarity: 'SEC', variant: 'base' })).toBe('gold');
    expect(holoPattern({ rarity: 'SR', variant: 'parallel' })).toBe('rainbow');
    expect(holoPattern({ rarity: 'SR', variant: 'sp' })).toBe('gold');
    expect(holoPattern({ rarity: 'SEC', variant: 'manga' })).toBe('ink');
  });
  it('bigger pulls wait and turn longer', () => {
    const order = ['common', 'rare', 'super', 'secret', 'chase'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(REVEAL_TIMING[order[i]].flip).toBeGreaterThan(REVEAL_TIMING[order[i - 1]].flip);
      expect(REVEAL_TIMING[order[i]].charge).toBeGreaterThanOrEqual(REVEAL_TIMING[order[i - 1]].charge);
    }
  });
});
