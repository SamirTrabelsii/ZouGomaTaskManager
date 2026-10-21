import type { AppData, LedgerEntry, SealedPack } from './types';
import { balance, formatBerries } from './economy';
import { cardById, cardSet, openPack, PACK, type Card, type Rng } from './cards';

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

/** Distinct prints owned out of a set's pack-obtainable prints (box toppers excluded). */
export function setProgress(d: AppData, setId: string): { owned: number; total: number } {
  const cards = cardSet(setId)?.cards.filter((c) => c.variant !== 'boxTopper') ?? [];
  return { owned: cards.filter((c) => d.cards.owned[c.id]).length, total: cards.length };
}
