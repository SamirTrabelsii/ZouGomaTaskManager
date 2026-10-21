import type { AppData, LedgerEntry, SealedPack } from './types';
import { balance, formatBerries } from './economy';
import { cardById, cardSet, cardSets, type Card, type CardSet, type Rarity, type SetKind, type Variant } from './cards';
import { hitRank, openPack, profileFor, type Rng } from './odds';

/* ───────── Card shop: spend Berries on sealed boosters, open them into the collection ───────── */

export interface Product {
  id: string;
  setId: string;
  kind: 'pack' | 'box';
  label: string;
  packs: number;
  price: number;
}

export const PACK_PRICE = 150;
/** A box is 24 packs for the price of 20. */
export const BOX_PRICE = 3000;
/** Per product type: a pack, and a box (about 17% off its packs). Premium packs carry foils in every pack. */
export const PRICES: Record<SetKind, { pack: number; box: number; label: string }> = {
  booster: { pack: PACK_PRICE, box: BOX_PRICE, label: 'Booster' },
  extra: { pack: PACK_PRICE, box: BOX_PRICE, label: 'Extra booster' },
  premium: { pack: 300, box: 5000, label: 'Premium booster' },
};

/** A pack and a box of the set, priced by product type; box size comes from the set's odds profile. */
export function productsFor(s: CardSet): Product[] {
  const price = PRICES[s.kind];
  return [
    { id: `${s.id}:pack`, setId: s.id, kind: 'pack', label: `${price.label} pack`, packs: 1, price: price.pack },
    { id: `${s.id}:box`, setId: s.id, kind: 'box', label: `${price.label} box`, packs: profileFor(s).boxPacks, price: price.box },
  ];
}

/** Sets on sale, newest first. */
export const shopSets = () => [...cardSets()].reverse();

export function productById(id: string): Product | null {
  const set = cardSet(id.slice(0, id.lastIndexOf(':')));
  return (set && productsFor(set).find((p) => p.id === id)) ?? null;
}

export type PurchaseResult = { ok: true; data: AppData; packs: SealedPack[] } | { ok: false; error: string };

/**
 * Buys a product: takes the Berries and adds its packs to the sealed pile, already rolled. Pure; `newId` and `rng`
 * are injected so tests are deterministic.
 */
export function purchase(d: AppData, productId: string, at: string, newId: () => string, rng: Rng = Math.random): PurchaseResult {
  const product = productById(productId);
  const set = product && cardSet(product.setId);
  if (!product || !set) return { ok: false, error: 'That product is not in the shop.' };
  const short = product.price - balance(d.ledger);
  if (short > 0) return { ok: false, error: `You need ${formatBerries(short)} more.` };
  const packs: SealedPack[] = Array.from({ length: product.packs }, () => ({
    id: newId(), setId: set.id, boughtAt: at, cards: openPack(set, rng).map((c) => c.id),
  }));
  const id = newId();
  const entry: LedgerEntry = { id, key: `buy:${id}`, kind: 'purchase', amount: -product.price, at, label: `${product.label} · ${set.id} ${set.name}` };
  return { ok: true, packs, data: { ...d, ledger: [...d.ledger, entry], cards: { ...d.cards, sealed: [...d.cards.sealed, ...packs] } } };
}

export interface OpenedPack {
  packId: string;
  setId: string;
  cards: Card[];
  /** Ids pulled for the first time by this pack (a second copy in the same pack is not new). */
  fresh: string[];
  /** How many packs this reveal covers: more than one when several were opened at once. */
  packs: number;
}

/** Opens a sealed pack: its cards join the collection right away, before any reveal animation. */
export function openSealed(d: AppData, packId: string): { data: AppData; opened: OpenedPack } | null {
  const pack = d.cards.sealed.find((p) => p.id === packId);
  if (!pack) return null;
  const owned = { ...d.cards.owned };
  const fresh: string[] = [];
  const cards = pack.cards.map(cardById).filter((c): c is Card => !!c);
  for (const c of cards) {
    if (!owned[c.id]) fresh.push(c.id);
    owned[c.id] = (owned[c.id] ?? 0) + 1;
  }
  return {
    data: { ...d, cards: { sealed: d.cards.sealed.filter((p) => p.id !== packId), owned } },
    opened: { packId: pack.id, setId: pack.setId, cards, fresh, packs: 1 },
  };
}

/**
 * Opens several sealed packs at once, for a quick summary instead of one reveal per pack. The cards come back
 * best first; `fresh` holds each card pulled for the first time once.
 */
export function openSealedMany(d: AppData, packIds: string[]): { data: AppData; opened: OpenedPack } | null {
  let data = d;
  const cards: Card[] = [];
  const fresh: string[] = [];
  let packs = 0;
  for (const id of packIds) {
    const r = openSealed(data, id);
    if (!r) continue;
    data = r.data;
    cards.push(...r.opened.cards);
    fresh.push(...r.opened.fresh);
    packs++;
  }
  if (!packs) return null;
  const setIds = new Set(packIds.map((id) => d.cards.sealed.find((p) => p.id === id)?.setId).filter(Boolean));
  const setId = setIds.size === 1 ? [...setIds][0]! : '';
  return {
    data,
    opened: { packId: packIds.join(','), setId, cards: [...cards].sort((a, b) => hitRank(b) - hitRank(a)), fresh, packs },
  };
}

/** Sealed packs grouped by set, in the order they were bought. */
export function sealedBySet(d: AppData): { setId: string; ids: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const p of d.cards.sealed) groups.set(p.setId, [...(groups.get(p.setId) ?? []), p.id]);
  return [...groups].map(([setId, ids]) => ({ setId, ids }));
}

/** The prints worth chasing in a set: the priciest on the market, then the rarest. */
export function chaseCards(set: CardSet, n = 6): Card[] {
  return set.cards
    .filter((c) => c.variant !== 'promo' && c.variant !== 'reprint')
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0) || hitRank(b) - hitRank(a) || a.id.localeCompare(b.id))
    .slice(0, n);
}

/* ───────── Selling duplicates ───────── */

/** Berries per US dollar of a card's market price at the last daily sync. */
export const SELL_RATE = 1;
/** The most one card sells for: a box. A $25,000 gold SP must not buy eight boxes at once. */
export const SELL_CAP = BOX_PRICE;
/** The least a card sells for, by rarity. */
export const SELL_FLOOR: Record<Rarity, number> = { C: 1, UC: 2, PR: 2, R: 5, L: 10, SR: 15, SEC: 40, TR: 60 };

/**
 * What one copy sells for. Tied to real market prices, so a chase card is a jackpot, but low enough that a whole pack
 * resells for ~25% of its price: selling never funds the next pack on its own.
 */
export const sellValue = (c: Card) => sellBreakdown(c).value;

/**
 * Why a card sells for what it does: its market price in Berries (`market`), its rarity's minimum when the market is
 * lower (`floor`), or the cap for very expensive cards (`cap`).
 */
export function sellBreakdown(c: Card): { value: number; basis: 'market' | 'floor' | 'cap'; market: number; floor: number } {
  const market = Math.round((c.price ?? 0) * SELL_RATE);
  const floor = SELL_FLOOR[c.rarity];
  if (market > SELL_CAP) return { value: SELL_CAP, basis: 'cap', market, floor };
  if (market < floor) return { value: floor, basis: 'floor', market, floor };
  return { value: market, basis: 'market', market, floor };
}

/** Copies beyond the first, per card. The first copy of every card always stays in the binder. */
export function duplicates(d: AppData): { card: Card; extra: number }[] {
  return Object.entries(d.cards.owned)
    .filter(([, n]) => n > 1)
    .map(([id, n]) => ({ card: cardById(id), extra: n - 1 }))
    .filter((x): x is { card: Card; extra: number } => !!x.card)
    .sort((a, b) => a.card.id.localeCompare(b.card.id));
}

export type SaleResult = { ok: true; data: AppData; earned: number; count: number } | { ok: false; error: string };

/** Sells duplicate copies. Refuses anything that would sell a card's last copy. */
export function sellCards(d: AppData, sales: { id: string; count: number }[], at: string, newId: () => string): SaleResult {
  const owned = { ...d.cards.owned };
  let earned = 0;
  let count = 0;
  for (const { id, count: n } of sales) {
    const card = cardById(id);
    if (!card || !Number.isInteger(n) || n < 1) return { ok: false, error: 'Nothing to sell.' };
    if ((owned[id] ?? 0) - n < 1) return { ok: false, error: `You'd lose your last ${card.name}. Only duplicates can be sold.` };
    owned[id] -= n;
    earned += sellValue(card) * n;
    count += n;
  }
  if (!count) return { ok: false, error: 'Nothing to sell.' };
  const only = sales.length === 1 ? cardById(sales[0].id) : null;
  const id = newId();
  const entry: LedgerEntry = {
    id, key: `sell:${id}`, kind: 'sale', amount: earned, at,
    label: only ? `Sold ${count > 1 ? `${count}× ` : ''}${only.name} (${only.number})` : `Sold ${count} duplicate cards`,
  };
  return { ok: true, earned, count, data: { ...d, ledger: [...d.ledger, entry], cards: { ...d.cards, owned } } };
}

/* ───────── Binder ───────── */

const VARIANT_ORDER: Record<Variant, number> = {
  base: 0, reprint: 1, foil: 2, parallel: 3, special: 4, superParallel: 5, sp: 6, tr: 7, manga: 8, promo: 9,
};

/** A set's binder pages: every print that comes in packs, by card number, alternate arts right after their base card. */
export function binderCards(setId: string): Card[] {
  return (cardSet(setId)?.cards ?? [])
    .filter((c) => c.variant !== 'promo')
    .sort((a, b) => a.number.localeCompare(b.number) || VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant] || a.id.localeCompare(b.id));
}

/** The whole collection at a glance: distinct prints, copies, sets started, and what the duplicates would sell for. */
export function collectionStats(d: AppData): { distinct: number; copies: number; sets: number; dupes: number; dupeValue: number } {
  const owned = Object.entries(d.cards.owned).filter(([, n]) => n > 0);
  const dupes = duplicates(d);
  return {
    distinct: owned.length,
    copies: owned.reduce((n, [, c]) => n + c, 0),
    sets: cardSets().filter((s) => s.cards.some((c) => d.cards.owned[c.id])).length,
    dupes: dupes.reduce((n, x) => n + x.extra, 0),
    dupeValue: dupes.reduce((n, x) => n + x.extra * sellValue(x.card), 0),
  };
}

/** Distinct prints owned out of a set's pack-obtainable prints (promos excluded). */
export function setProgress(d: AppData, setId: string): { owned: number; total: number } {
  const cards = cardSet(setId)?.cards.filter((c) => c.variant !== 'promo') ?? [];
  return { owned: cards.filter((c) => d.cards.owned[c.id]).length, total: cards.length };
}
