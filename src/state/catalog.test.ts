import { afterEach, describe, expect, it } from 'vitest';
import { fromWire } from './catalog';
import { BUNDLED_SETS, cardById, cardSet, cardSets, registerCatalog } from '../domain/cards';
import { productById, shopSets } from '../domain/shop';

const wire = {
  syncedAt: '2026-10-21T06:00:00.000Z',
  sets: [
    { id: 'OP-17', name: 'Strongest', kind: 'booster' as const, position: 21, cards: [['OP17-001', 'OP17-001_x.jpg', 'OP17-001', 'Kid', 'L', 'base', 'Red', 'Leader', 0.5]] },
    { id: 'EB-03', name: 'Heroines', kind: 'extra' as const, position: 18, cards: [['EB03-001', 'EB03-001.jpg', 'EB03-001', 'Vivi', 'L', 'base', 'Blue', 'Leader', null]] },
    { id: 'OP-01', name: 'Romance Dawn', kind: 'booster' as const, position: 0, cards: [['OP01-001', 'OP01-001.jpg', 'OP01-001', 'Zoro', 'L', 'base', 'Red', 'Leader', 1.7]] },
  ],
} as Parameters<typeof fromWire>[0];

afterEach(() => registerCatalog(BUNDLED_SETS));

describe('live catalog', () => {
  it('decodes the compact wire format', () => {
    expect(fromWire(wire)[0].cards[0]).toEqual({
      id: 'OP17-001', img: 'OP17-001_x.jpg', number: 'OP17-001', name: 'Kid', rarity: 'L', variant: 'base', color: 'Red', type: 'Leader', price: 0.5,
    });
  });
  it('replaces the bundled snapshot, keeping release order', () => {
    registerCatalog(fromWire(wire));
    expect(cardSets().map((s) => s.id)).toEqual(['OP-01', 'EB-03', 'OP-17']);
    expect(cardById('OP17-001')?.name).toBe('Kid');
    expect(cardSet('EB-03')?.kind).toBe('extra');
  });
  it('ignores an empty catalog, so the snapshot stays', () => {
    registerCatalog([]);
    expect(cardSets()).toEqual(BUNDLED_SETS);
  });
  it('sells every set, newest first, priced and boxed by product type', () => {
    registerCatalog(fromWire(wire));
    expect(shopSets().map((s) => s.id)).toEqual(['OP-17', 'EB-03', 'OP-01']);
    expect(productById('OP-17:box')).toMatchObject({ setId: 'OP-17', packs: 24 });
    expect(productById('EB-03:pack')).toMatchObject({ label: 'Extra booster pack', price: 150 });
    expect(productById('nope')).toBeNull();
  });
});
