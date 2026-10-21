import op01 from '../data/cards/OP-01.json';

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
export const cardImageUrl = (img: string, viaServer: boolean) =>
  viaServer ? `/api/cards/img/${encodeURIComponent(img)}` : `https://optcgapi.com/media/static/Card_Images/${encodeURIComponent(img)}`;

/* ───────── Booster packs ───────── */

/**
 * English booster: 12 cards, 24 packs per box. Bandai doesn't publish per-pack odds, so these are estimates tuned to
 * what openings report per box: ~6 Leaders, ~4 Super Rares, a Secret Rare every other box, ~2 parallels, and a
 * manga rare about once per case (12 boxes). Tune here; nothing else hard-codes odds.
 */
export const PACK = {
  size: 12,
  boxPacks: 24,
  commons: 7,
  uncommons: 3,
  /** One rare slot that can upgrade. */
  rareSlot: { SEC: 1 / 48, SR: 1 / 6 },
  /** One "hit" slot: a chase card, a Leader, or else one more Common. */
  hitSlot: { manga: 1 / 288, parallel: 1 / 12, leader: 1 / 4 },
  /** Secret Rare parallels are rarer than other parallels by this weight. */
  secParallelWeight: 0.25,
} as const;

export type Rng = () => number;

/** Small fast seedable RNG (mulberry32), for tests and reproducible openings. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: Rng): T {
  let r = rng() * items.reduce((n, t) => n + weight(t), 0);
  for (const t of items) if ((r -= weight(t)) < 0) return t;
  return items[items.length - 1];
}

/** `n` different cards from `pool` (the whole pool, shuffled, if it is smaller). */
function pickDistinct(pool: Card[], n: number, rng: Rng): Card[] {
  const left = [...pool];
  const out: Card[] = [];
  while (out.length < n && left.length) out.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return out;
}

/** How exciting a pulled card is; packs reveal from least to most. */
export function hitRank(c: Card): number {
  const rarity: Record<Rarity, number> = { C: 0, UC: 1, PR: 1, R: 2, L: 3, SR: 4, SEC: 5, TR: 6 };
  const variant: Record<Variant, number> = {
    base: 0, reprint: 0, promo: 0, foil: 8, parallel: 10, special: 12, superParallel: 14, sp: 16, tr: 18, manga: 20,
  };
  return rarity[c.rarity] + variant[c.variant];
}

/**
 * Rolls one booster of `set`. Returns the cards in reveal order: commons first, the best card last. Built for main
 * boosters; SP, Treasure Rare and other special prints aren't pulled yet.
 */
export function openPack(set: CardSet, rng: Rng = Math.random): Card[] {
  const base = (r: Rarity) => set.cards.filter((c) => c.variant === 'base' && c.rarity === r);
  const commons = pickDistinct(base('C'), PACK.commons + 1, rng);
  const pack = [...commons.slice(0, PACK.commons), ...pickDistinct(base('UC'), PACK.uncommons, rng)];

  const r = rng();
  const rareRarity: Rarity = r < PACK.rareSlot.SEC ? 'SEC' : r < PACK.rareSlot.SEC + PACK.rareSlot.SR ? 'SR' : 'R';
  // a set missing that rarity falls back to a Rare
  pack.push(pick(base(rareRarity).length ? base(rareRarity) : base('R'), rng));

  const h = rng();
  const { manga, parallel, leader } = PACK.hitSlot;
  const mangas = set.cards.filter((c) => c.variant === 'manga');
  const parallels = set.cards.filter((c) => c.variant === 'parallel');
  if (h < manga && mangas.length) pack.push(pick(mangas, rng));
  else if (h < manga + parallel && parallels.length) pack.push(pickWeighted(parallels, (c) => (c.rarity === 'SEC' ? PACK.secParallelWeight : 1), rng));
  else if (h < manga + parallel + leader && base('L').length) pack.push(pick(base('L'), rng));
  else if (commons[PACK.commons]) pack.push(commons[PACK.commons]);

  // a set short of some rarity yields a smaller pack rather than holes

  // stable sort keeps the slot order among equals
  return pack.filter(Boolean).map((c, i) => ({ c, i })).sort((a, b) => hitRank(a.c) - hitRank(b.c) || a.i - b.i).map((x) => x.c);
}
