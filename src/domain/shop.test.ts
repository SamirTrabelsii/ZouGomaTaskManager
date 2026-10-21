import { describe, expect, it } from 'vitest';
import { binderCards, duplicates, openSealed, purchase, PACK_PRICE, BOX_PRICE, sellCards, sellValue, setProgress } from './shop';
import { balance, welcomeEntry } from './economy';
import { cardById, cardSet } from './cards';
import { openPack, seededRng } from './odds';
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

describe('selling duplicates', () => {
  const owning = (owned: Record<string, number>, berries = 0): AppData => ({ ...withBerries(berries), cards: { sealed: [], owned } });

  it('prices follow the market snapshot, with a floor per rarity', () => {
    expect(sellValue(cardById('OP01-120_p2')!)).toBe(1533); // manga Shanks, $1532.80
    expect(sellValue(cardById('OP01-117')!)).toBe(1); // a common worth cents
    expect(sellValue(cardById('OP01-121')!)).toBeGreaterThanOrEqual(40); // SEC floor
  });
  it('a whole pack resells for well under its price, so selling never funds the next pack', () => {
    const set = cardSet('OP-01')!;
    const rng = seededRng(11);
    let total = 0;
    const packs = 24 * 400;
    for (let i = 0; i < packs; i++) total += openPack(set, rng).reduce((n, c) => n + sellValue(c), 0);
    expect(total / packs).toBeLessThan(PACK_PRICE * 0.35);
  });
  it('lists only copies beyond the first', () => {
    expect(duplicates(owning({ 'OP01-001': 3, 'OP01-002': 1 }))).toEqual([{ card: cardById('OP01-001'), extra: 2 }]);
  });
  it('sells duplicates for berries, recorded in the ledger', () => {
    const r = sellCards(owning({ 'OP01-016': 3 }), [{ id: 'OP01-016', count: 2 }], 'now', newId);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.cards.owned['OP01-016']).toBe(1);
    expect(r.earned).toBe(sellValue(cardById('OP01-016')!) * 2);
    expect(balance(r.data.ledger)).toBe(r.earned);
    expect(r.data.ledger.at(-1)).toMatchObject({ kind: 'sale', label: 'Sold 2× Nami (OP01-016)' });
  });
  it('never sells the last copy, and changes nothing when refused', () => {
    const d = owning({ 'OP01-016': 2, 'OP01-001': 1 });
    expect(sellCards(d, [{ id: 'OP01-016', count: 2 }], 'now', newId).ok).toBe(false);
    expect(sellCards(d, [{ id: 'OP01-016', count: 1 }, { id: 'OP01-001', count: 1 }], 'now', newId).ok).toBe(false);
    expect(sellCards(d, [{ id: 'OP01-016', count: 0 }], 'now', newId).ok).toBe(false);
    expect(sellCards(d, [{ id: 'NOPE', count: 1 }], 'now', newId).ok).toBe(false);
  });
});

describe('binder', () => {
  it('holds every pullable print, alternate arts right after their base card', () => {
    const cards = binderCards('OP-01');
    expect(cards).toHaveLength(148);
    const i = cards.findIndex((c) => c.id === 'OP01-120');
    expect(cards.slice(i, i + 3).map((c) => c.id)).toEqual(['OP01-120', 'OP01-120_p1', 'OP01-120_p2']);
    expect(cards.some((c) => c.variant === 'promo')).toBe(false);
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
