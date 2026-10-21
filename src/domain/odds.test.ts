import { describe, expect, it } from 'vitest';
import { cardSet, type Card, type CardSet, type Rarity, type SetKind, type Variant } from './cards';
import { expectedPerBox, hitRank, openPack, POOLS, profileFor, seededRng, type Pool } from './odds';

const op01 = cardSet('OP-01')!;

/** A made-up set with `n` prints of each (rarity, variant) asked for. */
function fakeSet(id: string, kind: SetKind, spec: [Rarity, Variant, number][]): CardSet {
  const cards: Card[] = [];
  for (const [rarity, variant, n] of spec) {
    for (let i = 0; i < n; i++) {
      const cid = `${id}-${rarity}-${variant}-${i}`;
      cards.push({ id: cid, img: `${cid}.jpg`, number: cid, name: cid, rarity, variant, color: 'Red', type: 'Character', price: 1 });
    }
  }
  return { id, name: id, kind, position: 99, cards };
}

const perBox = (set: CardSet, pool: Pool, boxes: number, seed = 7) => {
  const rng = seededRng(seed);
  const { boxPacks } = profileFor(set);
  let n = 0;
  for (let i = 0; i < boxes * boxPacks; i++) n += openPack(set, rng).filter(POOLS[pool]).length;
  return n / boxes;
};

describe('main booster', () => {
  it('gives 12 cards: 7+ commons, 3 uncommons, a Rare and a hit', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const p = openPack(op01, rng);
      expect(p).toHaveLength(12);
      expect(p.filter(POOLS.UC)).toHaveLength(3);
      expect(p.filter(POOLS.C).length).toBeGreaterThanOrEqual(7);
      expect(p.some((c) => c.variant === 'promo')).toBe(false);
    }
  });
  it('never holds the same card twice', () => {
    const rng = seededRng(2);
    for (let i = 0; i < 300; i++) {
      const ids = openPack(op01, rng).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('reveals from least to most exciting, so the best card is last', () => {
    const ranks = openPack(op01, seededRng(3)).map(hitRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
  it('is reproducible with the same seed', () => {
    expect(openPack(op01, seededRng(42)).map((c) => c.id)).toEqual(openPack(op01, seededRng(42)).map((c) => c.id));
  });
  it('lands on the counted English rates: ~24 Rares, ~7 Super Rares, ~2 alternate arts per box', () => {
    expect(perBox(op01, 'R', 400)).toBeCloseTo(24, 0);
    expect(perBox(op01, 'SR', 400)).toBeGreaterThan(6.5);
    expect(perBox(op01, 'SR', 400)).toBeLessThan(7.5);
    expect(perBox(op01, 'parallel', 400)).toBeGreaterThan(1.7);
    expect(perBox(op01, 'parallel', 400)).toBeLessThan(2.3);
    expect(perBox(op01, 'SEC', 400)).toBeGreaterThan(0.6);
    expect(perBox(op01, 'SEC', 400)).toBeLessThan(0.9);
  });
  it('uses counted per-set data where it exists', () => {
    expect(profileFor({ id: 'OP-17', kind: 'booster' }).confidence).toBe('medium');
    expect(profileFor({ id: 'OP-02', kind: 'booster' }).confidence).toBe('low');
  });
  it('a hit a set doesn\'t have (no Treasure Rare in OP-01) becomes a common, never a hole', () => {
    expect(perBox(op01, 'tr', 50)).toBe(0);
  });
  it('pulls SP cards and Treasure Rares in sets that have them', () => {
    const set = fakeSet('OPX', 'booster', [['C', 'base', 45], ['UC', 'base', 30], ['R', 'base', 26], ['SR', 'base', 10], ['SEC', 'base', 2],
      ['L', 'base', 6], ['SR', 'sp', 6], ['TR', 'tr', 1]]);
    const sp = perBox(set, 'sp', 2400, 9);
    expect(sp).toBeGreaterThan(0.08);
    expect(sp).toBeLessThan(0.17);
    expect(perBox(set, 'tr', 2400, 9)).toBeGreaterThan(0.05);
  });
});

describe('extra booster', () => {
  const eb = fakeSet('EB-09', 'extra', [['C', 'base', 28], ['R', 'base', 21], ['SR', 'base', 8], ['SEC', 'base', 1], ['L', 'base', 3], ['SR', 'parallel', 18]]);
  it('gives 12 cards without uncommons', () => {
    const rng = seededRng(4);
    for (let i = 0; i < 100; i++) {
      const p = openPack(eb, rng);
      expect(p).toHaveLength(12);
      expect(p.filter((c) => c.rarity === 'UC')).toHaveLength(0);
    }
  });
});

describe('premium booster', () => {
  const prb = fakeSet('PRB-09', 'premium', [['C', 'reprint', 23], ['UC', 'reprint', 25], ['R', 'reprint', 21], ['SR', 'reprint', 27],
    ['SEC', 'reprint', 8], ['UC', 'foil', 40], ['SR', 'parallel', 30], ['SEC', 'manga', 3]]);
  it('gives 9 collectible cards (the DON!! isn\'t collected), with foils in every pack', () => {
    const rng = seededRng(5);
    for (let i = 0; i < 100; i++) {
      const p = openPack(prb, rng);
      expect(p).toHaveLength(9);
      expect(p.filter(POOLS.foil).length).toBeGreaterThanOrEqual(2);
    }
  });
  it('comes 20 packs to a box', () => expect(profileFor(prb).boxPacks).toBe(20));
  it('a Secret Rare outranks a foil Uncommon in the reveal', () => {
    const sec = prb.cards.find((c) => c.rarity === 'SEC' && c.variant === 'reprint')!;
    const foil = prb.cards.find((c) => c.rarity === 'UC' && c.variant === 'foil')!;
    expect(hitRank(sec)).toBeGreaterThan(hitRank(foil));
  });
});

describe('odds table', () => {
  it('per-box expectations add up to every card in a box', () => {
    for (const set of [op01, fakeSet('EB-09', 'extra', [['C', 'base', 28], ['R', 'base', 21], ['SR', 'base', 8], ['L', 'base', 3]])]) {
      const p = profileFor(set);
      const total = expectedPerBox(set).reduce((n, e) => n + e.perBox, 0);
      expect(total).toBeCloseTo(p.cards * p.boxPacks, 6);
    }
  });
  it('no slot\'s chances add up to more than one, in any profile', () => {
    for (const [id, kind] of [['OP-01', 'booster'], ['OP-17', 'booster'], ['EB-02', 'extra'], ['EB-01', 'extra'], ['PRB-01', 'premium']] as const) {
      for (const slot of profileFor({ id, kind }).slots) {
        expect(Object.values(slot.odds ?? {}).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('only lists what the set can actually give', () => {
    const pools = expectedPerBox(op01).map((e) => e.pool);
    expect(pools).toContain('manga');
    expect(pools).not.toContain('tr');
  });
});
