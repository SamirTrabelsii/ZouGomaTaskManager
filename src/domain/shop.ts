import type { AppData, LedgerEntry, SealedPack } from './types';
import { balance, formatBerries } from './economy';
import { cardById, cardSet, openPack, PACK, type Card, type Rarity, type Rng } from './cards';

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

export const PRODUCTS: Product[] = [
  { id: 'OP-01:pack', setId: 'OP-01', kind: 'pack', label: 'Booster pack', packs: 1, price: PACK_PRICE },
  { id: 'OP-01:box', setId: 'OP-01', kind: 'box', label: 'Booster box', packs: PACK.boxPacks, price: BOX_PRICE },
];
export const productById = (id: string) => PRODUCTS.find((p) => p.id === id) ?? null;

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
    opened: { packId: pack.id, setId: pack.setId, cards, fresh },
  };
}

/* ───────── Selling duplicates ───────── */

/** Berries per US dollar of a card's market price when it was snapshotted. */
export const SELL_RATE = 1;
/** The least a card sells for, by rarity. */
export const SELL_FLOOR: Record<Rarity, number> = { C: 1, UC: 2, R: 5, L: 10, SR: 15, SEC: 40 };

/**
 * What one copy sells for. Tied to real market prices, so a chase card is a jackpot, but low enough that a whole pack
 * resells for ~25% of its price: selling never funds the next pack on its own.
 */
export const sellValue = (c: Card) => Math.max(SELL_FLOOR[c.rarity], Math.round((c.price ?? 0) * SELL_RATE));

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

const VARIANT_ORDER = { base: 0, parallel: 1, manga: 2, boxTopper: 3 } as const;

/** A set's binder pages: every print you can pull, by card number, alternate arts right after their base card. */
export function binderCards(setId: string): Card[] {
  return (cardSet(setId)?.cards ?? [])
    .filter((c) => c.variant !== 'boxTopper')
    .sort((a, b) => a.number.localeCompare(b.number) || VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant] || a.id.localeCompare(b.id));
}

/** Distinct prints owned out of a set's pack-obtainable prints (box toppers excluded). */
export function setProgress(d: AppData, setId: string): { owned: number; total: number } {
  const cards = cardSet(setId)?.cards.filter((c) => c.variant !== 'boxTopper') ?? [];
  return { owned: cards.filter((c) => d.cards.owned[c.id]).length, total: cards.length };
}
