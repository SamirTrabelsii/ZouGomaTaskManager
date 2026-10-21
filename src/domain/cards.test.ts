import { describe, expect, it } from 'vitest';
import { cardSets, cardById, cardImageUrl, cardSet } from './cards';

const op01 = cardSet('OP-01')!;

describe('OP-01 catalog', () => {
  it('has the full Romance Dawn list: 121 base cards with the official rarity split', () => {
    const base = op01.cards.filter((c) => c.variant === 'base');
    const count = (r: string) => base.filter((c) => c.rarity === r).length;
    expect(base).toHaveLength(121);
    expect([count('L'), count('C'), count('UC'), count('R'), count('SR'), count('SEC')]).toEqual([8, 45, 30, 26, 10, 2]);
  });
  it('every print has a unique id, a card number and a name', () => {
    const ids = cardSets().flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of op01.cards) {
      expect(c.id.startsWith(c.number)).toBe(true);
      expect(c.name).not.toMatch(/[()]/);
    }
  });
  it('finds cards by id and builds image urls', () => {
    expect(cardById('OP01-120_p2')).toMatchObject({ name: 'Shanks', variant: 'manga', rarity: 'SEC' });
    expect(cardImageUrl('OP16-011_l76oKss.jpg', true)).toBe('/api/cards/img/OP16-011_l76oKss.jpg');
    expect(cardImageUrl('OP01-001.jpg', false)).toBe('https://optcgapi.com/media/static/Card_Images/OP01-001.jpg');
  });
});
