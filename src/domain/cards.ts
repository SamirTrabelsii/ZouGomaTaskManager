import op01 from '../data/cards/OP-01.json';
import { PACK_ART, type PackBox } from '../../server/packArt';

/*
 * ───────── One Piece TCG catalog ─────────
 * Real card facts for every set on optcgapi.com. The server syncs them daily (server/catalog.ts) and the app loads
 * them at start (state/catalog.ts). Until then, and in local-only mode, the bundled OP-01 snapshot is used.
 */

export type Rarity = 'L' | 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'TR' | 'PR';
/**
 * base = regular print · parallel = alternate art · superParallel = super/red super alternate art · sp = Special card
 * · manga = manga rare · tr = Treasure Rare · special = other named chase prints (wanted poster, signature, Pandaman
 * art) · foil / reprint = Premium Booster prints · promo = never in packs (box toppers, dash packs).
 * Must match server/catalog.ts.
 */
export type Variant = 'base' | 'parallel' | 'superParallel' | 'sp' | 'manga' | 'tr' | 'special' | 'foil' | 'reprint' | 'promo';
export type SetKind = 'booster' | 'extra' | 'premium';

export interface Card {
  /** Unique per print, the key collections use: "OP01-120", "OP01-120_p1", "OP16-011~tr". */
  id: string;
  /** The art's file name on optcgapi.com. */
  img: string;
  /** The printed card number, shared by every print of the card: "OP01-120". */
  number: string;
  name: string;
  rarity: Rarity;
  variant: Variant;
  color: string;
  type: string;
  /** Market price in USD at the last sync; null if unknown. */
  price: number | null;
}

export interface CardSet {
  id: string;
  name: string;
  kind: SetKind;
  /** Release order (optcgapi's list order). */
  position: number;
  cards: Card[];
}

export const RARITY_LABEL: Record<Rarity, string> = {
  L: 'Leader', C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare', SEC: 'Secret Rare', TR: 'Treasure Rare', PR: 'Promo',
};

export const BUNDLED_SETS: CardSet[] = [op01 as CardSet];

let sets: CardSet[] = BUNDLED_SETS;
// a print can appear in several sets (reprints, dash packs): the first listing wins
let byId = new Map<string, Card>();
const index = () => { byId = new Map(); for (const s of sets) for (const c of s.cards) if (!byId.has(c.id)) byId.set(c.id, c); };
index();

/** Swaps in a newer catalog (an empty one is ignored, so the bundled snapshot stays). */
export function registerCatalog(next: CardSet[]) {
  if (!next.length) return;
  sets = [...next].sort((a, b) => a.position - b.position);
  index();
}

/** Every known set, in release order. */
export const cardSets = () => sets;
export const cardSet = (id: string) => sets.find((s) => s.id === id) ?? null;
export const cardById = (id: string) => byId.get(id) ?? null;

/**
 * Card art. Signed-in (server present): the server's caching proxy, so each image is fetched from optcgapi.com once.
 * Local-only mode has no server, so it loads straight from optcgapi.com.
 */
/**
 * The set's official booster pack picture and where the pack sits in it, or null for a set without one. Bandai's site
 * forbids embedding its images elsewhere (Cross-Origin-Resource-Policy), so they only come through the server's proxy:
 * local-only mode keeps the drawn wrapper.
 */
export function packArt(setId: string, viaServer: boolean): { src: string; box: PackBox } | null {
  const art = viaServer && Object.hasOwn(PACK_ART, setId) ? PACK_ART[setId] : null;
  return art && { src: `/api/cards/pack/${encodeURIComponent(setId)}`, box: art.box };
}

export const cardImageUrl = (img: string, viaServer: boolean) =>
  viaServer ? `/api/cards/img/${encodeURIComponent(img)}` : `https://optcgapi.com/media/static/Card_Images/${encodeURIComponent(img)}`;
