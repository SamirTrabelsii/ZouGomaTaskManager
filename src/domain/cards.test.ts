import { describe, expect, it } from 'vitest';
import { CARD_SETS, cardById, cardImageUrl, cardSet, hitRank, openPack, PACK, seededRng, type Card } from './cards';

const op01 = cardSet('OP-01')!;

describe('OP-01 catalog', () => {
  it('has the full Romance Dawn list: 121 base cards with the official rarity split', () => {
    const base = op01.cards.filter((c) => c.variant === 'base');
    const count = (r: string) => base.filter((c) => c.rarity === r).length;
    expect(base).toHaveLength(121);
    expect([count('L'), count('C'), count('UC'), count('R'), count('SR'), count('SEC')]).toEqual([8, 45, 30, 26, 10, 2]);
  });
  it('every print has a unique id, a card number and a name', () => {
    const ids = CARD_SETS.flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of op01.cards) {
      expect(c.id.startsWith(c.number)).toBe(true);
      expect(c.name).not.toMatch(/[()]/);
    }
  });
  it('finds cards by id and builds image urls', () => {
    expect(cardById('OP01-120_p2')).toMatchObject({ name: 'Shanks', variant: 'manga', rarity: 'SEC' });
    expect(cardImageUrl('OP01-001', true)).toBe('/api/cards/img/OP01-001');
    expect(cardImageUrl('OP01-001', false)).toBe('https://optcgapi.com/media/static/Card_Images/OP01-001.jpg');
  });
});

describe('opening a pack', () => {
  it('gives 12 cards: 7+ commons, 3 uncommons, a rare-slot card and a hit-slot card', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const p = openPack(op01, rng);
      expect(p).toHaveLength(PACK.size);
      expect(p.filter((c) => c.rarity === 'UC' && c.variant === 'base')).toHaveLength(3);
      expect(p.filter((c) => c.rarity === 'C' && c.variant === 'base').length).toBeGreaterThanOrEqual(7);
      expect(p.some((c) => c.variant === 'boxTopper')).toBe(false);
    }
  });
  it('never repeats a common or uncommon within one pack', () => {
    const rng = seededRng(2);
    for (let i = 0; i < 200; i++) {
      const lows = openPack(op01, rng).filter((c) => (c.rarity === 'C' || c.rarity === 'UC') && c.variant === 'base');
      expect(new Set(lows.map((c) => c.id)).size).toBe(lows.length);
    }
  });
  it('reveals from least to most exciting, so the best card is last', () => {
    const p = openPack(op01, seededRng(3));
    const ranks = p.map(hitRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it('is reproducible with the same seed', () => {
    expect(openPack(op01, seededRng(42)).map((c) => c.id)).toEqual(openPack(op01, seededRng(42)).map((c) => c.id));
  });
  it('over many boxes, hits land near the target rates per box', () => {
    const rng = seededRng(7);
    const boxes = 500;
    const pulled: Card[] = [];
    for (let i = 0; i < boxes * PACK.boxPacks; i++) pulled.push(...openPack(op01, rng));
    const perBox = (f: (c: Card) => boolean) => pulled.filter(f).length / boxes;
    expect(perBox((c) => c.variant === 'base' && c.rarity === 'SR')).toBeCloseTo(4, 0);
    expect(perBox((c) => c.variant === 'base' && c.rarity === 'SEC')).toBeGreaterThan(0.35);
    expect(perBox((c) => c.variant === 'base' && c.rarity === 'SEC')).toBeLessThan(0.65);
    expect(perBox((c) => c.variant === 'base' && c.rarity === 'L')).toBeCloseTo(6, 0);
    expect(perBox((c) => c.variant === 'parallel')).toBeCloseTo(2, 0);
    expect(perBox((c) => c.variant === 'manga')).toBeLessThan(0.2);
  });
});
