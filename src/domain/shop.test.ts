import { describe, expect, it } from 'vitest';
import { openSealed, purchase, PACK_PRICE, BOX_PRICE, setProgress } from './shop';
import { balance, welcomeEntry } from './economy';
import { seededRng } from './cards';
import { emptyData, normalize } from '../data/storage';
import type { AppData } from './types';

let n = 0;
const newId = () => `id${++n}`;
const withBerries = (amount: number): AppData => ({
  ...emptyData(),
  ledger: [{ ...welcomeEntry('w', '2026-10-01T10:00:00.000Z'), amount }],
});

describe('buying', () => {
  it('a pack costs 150 berries and adds one sealed, already-rolled pack', () => {
    const r = purchase(withBerries(450), 'OP-01:pack', '2026-10-21T10:00:00.000Z', newId, seededRng(1));
    if (!r.ok) throw new Error(r.error);
    expect(balance(r.data.ledger)).toBe(450 - PACK_PRICE);
    expect(r.data.cards.sealed).toHaveLength(1);
    expect(r.data.cards.sealed[0].cards).toHaveLength(12);
    expect(r.data.ledger.at(-1)).toMatchObject({ kind: 'purchase', amount: -PACK_PRICE });
  });
  it('a box adds 24 packs for 3000', () => {
    const r = purchase(withBerries(3000), 'OP-01:box', '2026-10-21T10:00:00.000Z', newId, seededRng(2));
    if (!r.ok) throw new Error(r.error);
    expect(r.data.cards.sealed).toHaveLength(24);
    expect(balance(r.data.ledger)).toBe(3000 - BOX_PRICE);
  });
  it('refuses when the balance is too low, and changes nothing', () => {
    const d = withBerries(100);
    expect(purchase(d, 'OP-01:pack', '', newId)).toEqual({ ok: false, error: 'You need ฿50 more.' });
  });
  it('refuses unknown products', () => {
    expect(purchase(withBerries(9999), 'OP-99:pack', '', newId).ok).toBe(false);
  });
  it('each purchase has its own ledger key', () => {
    let d = withBerries(450);
    for (let i = 0; i < 2; i++) {
      const r = purchase(d, 'OP-01:pack', '', newId);
      if (!r.ok) throw new Error(r.error);
      d = r.data;
    }
    const keys = d.ledger.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('opening', () => {
  const bought = () => {
    const r = purchase(withBerries(450), 'OP-01:pack', '', newId, seededRng(3));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };
  it('moves the pack into the collection and reveals exactly the cards rolled at purchase', () => {
    const d = bought();
    const rolled = d.cards.sealed[0].cards;
    const r = openSealed(d, d.cards.sealed[0].id)!;
    expect(r.opened.cards.map((c) => c.id)).toEqual(rolled);
    expect(r.data.cards.sealed).toEqual([]);
    expect(Object.values(r.data.cards.owned).reduce((a, b) => a + b, 0)).toBe(12);
  });
  it('marks first copies as new, and counts duplicates', () => {
    const d = bought();
    const pack = d.cards.sealed[0];
    const first = pack.cards[0];
    const r = openSealed({ ...d, cards: { ...d.cards, owned: { [first]: 2 } } }, pack.id)!;
    expect(r.opened.fresh).not.toContain(first);
    expect(r.data.cards.owned[first]).toBe(3);
    expect(r.opened.fresh.length).toBe(new Set(pack.cards).size - 1);
  });
  it('an unknown pack id opens nothing', () => {
    expect(openSealed(bought(), 'nope')).toBeNull();
  });
  it('counts set progress by distinct prints, without box toppers', () => {
    const d = { ...emptyData(), cards: { sealed: [], owned: { 'OP01-001': 3, 'OP01-120_p2': 1, 'OP01-008_p1': 1 } } };
    expect(setProgress(d, 'OP-01')).toEqual({ owned: 2, total: 148 });
  });
});

describe('saved collection', () => {
  it('older data starts with an empty collection', () => {
    expect(normalize({ version: 2 }).cards).toEqual({ sealed: [], owned: {} });
  });
  it('drops malformed packs and counts', () => {
    const d = normalize({
      version: 3,
      cards: {
        sealed: [{ id: 'a', setId: 'OP-01', boughtAt: '', cards: ['OP01-001'] }, { id: 'b', setId: 'OP-01', cards: [] }, { id: 'c', cards: [1] }],
        owned: { 'OP01-001': 2, 'OP01-002': 0, 'OP01-003': 1.5, 'OP01-004': 'x' },
      },
    });
    expect(d.cards.sealed.map((p) => p.id)).toEqual(['a']);
    expect(d.cards.owned).toEqual({ 'OP01-001': 2 });
  });
});
