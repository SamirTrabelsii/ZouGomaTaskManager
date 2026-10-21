import type { Card, CardSet, Rarity, SetKind, Variant } from './cards';

/*
 * ───────── Pull rates ─────────
 * Bandai publishes no odds for the One Piece Card Game. These profiles use the best public numbers: community counts
 * from opened English cases and boxes, with their sources and how much to trust them. A set's profile is its product
 * type's profile, adjusted per set where counted data exists. Rates are written per box, like the sources quote them.
 */

/** Groups of prints a pack slot can draw from. */
export type Pool =
  | 'C' | 'UC' | 'R' | 'SR' | 'SEC' | 'L'
  | 'parallel' | 'parallelLeader' | 'superParallel' | 'sp' | 'tr' | 'manga' | 'special'
  | 'foil' | 'reprintLow' | 'reprintR' | 'reprintSR' | 'reprintSEC';

const regular = (c: Card, ...r: Rarity[]) => (c.variant === 'base' || c.variant === 'reprint') && r.includes(c.rarity);
const is = (c: Card, v: Variant) => c.variant === v;

/** Which prints belong to each pool. Promos never come from packs. */
export const POOLS: Record<Pool, (c: Card) => boolean> = {
  C: (c) => regular(c, 'C'),
  UC: (c) => regular(c, 'UC'),
  R: (c) => regular(c, 'R'),
  SR: (c) => regular(c, 'SR'),
  SEC: (c) => regular(c, 'SEC'),
  L: (c) => regular(c, 'L'),
  parallel: (c) => is(c, 'parallel') && c.rarity !== 'L',
  parallelLeader: (c) => is(c, 'parallel') && c.rarity === 'L',
  superParallel: (c) => is(c, 'superParallel'),
  sp: (c) => is(c, 'sp'),
  tr: (c) => is(c, 'tr'),
  manga: (c) => is(c, 'manga'),
  special: (c) => is(c, 'special'),
  foil: (c) => is(c, 'foil'),
  reprintLow: (c) => is(c, 'reprint') && (c.rarity === 'C' || c.rarity === 'UC' || c.rarity === 'PR'),
  reprintR: (c) => is(c, 'reprint') && c.rarity === 'R',
  reprintSR: (c) => is(c, 'reprint') && (c.rarity === 'SR' || c.rarity === 'L'),
  reprintSEC: (c) => is(c, 'reprint') && c.rarity === 'SEC',
};

export const POOL_LABEL: Record<Pool, string> = {
  C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare', SEC: 'Secret Rare', L: 'Leader',
  parallel: 'Alternate art', parallelLeader: 'Alternate-art Leader', superParallel: 'Super alternate art', sp: 'SP card',
  tr: 'Treasure Rare', manga: 'Manga Rare', special: 'Special print', foil: 'Foil', reprintLow: 'Common / Uncommon',
  reprintR: 'Rare', reprintSR: 'Super Rare', reprintSEC: 'Secret Rare',
};

/**
 * One kind of card position in a pack. `count` positions each draw `odds` (chance per pack of each pool) and
 * otherwise `fallback`. A pack never holds the same card twice (while the pool has others).
 */
export interface Slot { label: string; count: number; fallback: Pool; odds?: Partial<Record<Pool, number>> }

export type Confidence = 'medium' | 'low';
export interface Source { label: string; url: string }

export interface OddsProfile {
  name: string;
  /** Cards you get per pack (DON!! cards aren't collected, so they're not counted). */
  cards: number;
  boxPacks: number;
  slots: Slot[];
  confidence: Confidence;
  sources: Source[];
  note: string;
}

const S = {
  tcgtalk: { label: 'TCGTalk box pull rates', url: 'https://tcgtalk.com/guides/one-piece-tcg-box-pull-rates' },
  cambridge: { label: 'Cambridge TCG pull rates (2026-07)', url: 'https://cambridgetcg.com/pulls/one-piece' },
  op15: { label: 'TCGTalk OP-15 case opening', url: 'https://tcgtalk.com/guides/op15-pull-rates-case-opening' },
  op16: { label: 'TCGTalk OP-16 case opening', url: 'https://tcgtalk.com/guides/op16-pull-rates-case-opening' },
  op17: { label: 'TCGTalk OP-17, 1,000+ packs', url: 'https://tcgtalk.com/guides/op17-pull-rates-case-opening' },
  eb01: { label: 'Bandai EB-01 product page', url: 'https://en.onepiece-cardgame.com/products/boosters/eb01.php' },
  eb02: { label: 'Samurai Sword EB-02 rates (JP)', url: 'https://www.samuraiswordtokyo.com/blogs/news/eb-02-anime-25th-collection-pull-rates-best-cards' },
  eb03: { label: 'Samurai Sword EB-03 rates (JP)', url: 'https://www.samuraiswordtokyo.com/blog/eb-03-heroines-pull-rates-god-pack' },
  prb01: { label: 'Bandai PRB-01 product page', url: 'https://en.onepiece-cardgame.com/products/boosters/prb01.php' },
} satisfies Record<string, Source>;

/** Per-box rates → per-pack chances for one slot position. */
const perBox = (boxPacks: number, rates: Partial<Record<Pool, number>>) =>
  Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v / boxPacks])) as Partial<Record<Pool, number>>;

/**
 * English main booster: 12 cards, 24 per box. Counted English openings: about one Rare per pack, ~7 Super Rares and
 * ~0.75 Secret Rare per box, ~2 alternate arts per box, an alternate-art Leader every ~3 boxes, SP ~1.5 and Treasure
 * Rare ~1 per 12-box case, a Manga Rare every ~4 cases.
 */
export const BOOSTER_HITS: Partial<Record<Pool, number>> = {
  SR: 7, SEC: 0.75, L: 2, parallel: 2, parallelLeader: 0.3, sp: 1.5 / 12, tr: 1 / 12, superParallel: 1 / 12,
  special: 1 / 12, manga: 1 / 48,
};

function booster(hits: Partial<Record<Pool, number>>, extra: Partial<OddsProfile> = {}): OddsProfile {
  return {
    name: 'Booster', cards: 12, boxPacks: 24, confidence: 'low',
    slots: [
      { label: 'Commons', count: 7, fallback: 'C' },
      { label: 'Uncommons', count: 3, fallback: 'UC' },
      { label: 'Rare', count: 1, fallback: 'R' },
      { label: 'Hit', count: 1, fallback: 'C', odds: perBox(24, hits) },
    ],
    sources: [S.cambridge, S.tcgtalk],
    note: 'English 12-card booster. Bandai publishes no odds: these are averages of counted community openings.',
    ...extra,
  };
}

/** Extra Booster: 12 cards, 24 per box, no Uncommons (Bandai's EB-01 page). Hit rates follow main boosters. */
function extra(hits: Partial<Record<Pool, number>>, more: Partial<OddsProfile> = {}): OddsProfile {
  return {
    name: 'Extra Booster', cards: 12, boxPacks: 24, confidence: 'low',
    slots: [
      { label: 'Commons', count: 8, fallback: 'C' },
      { label: 'Rares', count: 2, fallback: 'R' },
      { label: 'Rare', count: 1, fallback: 'R', odds: perBox(24, { SR: 6, SEC: 0.5 }) },
      { label: 'Hit', count: 1, fallback: 'C', odds: perBox(24, hits) },
    ],
    sources: [S.eb01, S.cambridge],
    note: 'Extra Boosters have no Uncommons. Rates are estimates from main-booster data and Japanese openings.',
    ...more,
  };
}

/**
 * Premium Booster: 10 cards (one is a DON!!, not collected here), 20 per box. Reprints of past hits; every pack carries
 * foils. Bandai lists no slot guarantees, so the layout follows retailer pack descriptions.
 */
const PREMIUM: OddsProfile = {
  name: 'Premium Booster', cards: 9, boxPacks: 20, confidence: 'low',
  slots: [
    { label: 'Commons / Uncommons', count: 4, fallback: 'reprintLow' },
    { label: 'Rare', count: 1, fallback: 'reprintR' },
    { label: 'Super Rare', count: 1, fallback: 'reprintSR', odds: perBox(20, { reprintSEC: 4 }) },
    { label: 'Foils', count: 2, fallback: 'foil' },
    { label: 'Hit', count: 1, fallback: 'foil', odds: perBox(20, { parallel: 4, sp: 0.5, manga: 0.1 }) },
  ],
  sources: [S.prb01, S.cambridge],
  note: 'Premium Booster: 10-card packs (incl. one DON!! card, not collected), two foils in every pack. Rates are estimates.',
};

/** Per-set adjustments where counted data exists. */
const BY_SET: Record<string, OddsProfile> = {
  'OP-15': booster({ ...BOOSTER_HITS, SR: 3.5, SEC: 0.6, L: 1, parallel: 1, parallelLeader: 0.29, sp: 0.2, manga: 0.08 },
    { confidence: 'medium', sources: [S.op15, S.cambridge] }),
  'OP15-EB04': booster({ ...BOOSTER_HITS, SR: 3.5, SEC: 0.6, L: 1, parallel: 1, parallelLeader: 0.29, sp: 0.2, manga: 0.08 },
    { confidence: 'medium', sources: [S.op15, S.cambridge] }),
  'OP-16': booster({ ...BOOSTER_HITS, SR: 8, SEC: 0.75, parallel: 2, sp: 1.5 / 12, tr: 1 / 12, manga: 1 / 48 },
    { confidence: 'medium', sources: [S.op16, S.cambridge] }),
  'OP-17': booster({ ...BOOSTER_HITS, SR: 7, SEC: 0.4, parallel: 1.5, parallelLeader: 4 / 12, sp: 2 / 12, tr: 1 / 12, special: 7 / 12, manga: 1 / 24 },
    { confidence: 'medium', sources: [S.op17, S.cambridge] }),
  'OP-05': booster({ ...BOOSTER_HITS, sp: 2.5 / 12 }),
  'OP-07': booster({ ...BOOSTER_HITS, sp: 1 / 12 }),
  'EB-02': extra({ L: 1, parallel: 2, sp: 2, manga: 24 / 140 / 12 }, { sources: [S.eb02, S.eb01] }),
  'EB-03': extra({ L: 1, parallel: 2, sp: 0.5, manga: 1 / 48 }, { sources: [S.eb03, S.eb01] }),
};

const BY_KIND: Record<SetKind, OddsProfile> = {
  booster: booster(BOOSTER_HITS),
  extra: extra({ L: 1, parallel: 2, sp: 0.25, manga: 1 / 48 }),
  premium: PREMIUM,
};

export const profileFor = (set: Pick<CardSet, 'id' | 'kind'>): OddsProfile => BY_SET[set.id] ?? BY_KIND[set.kind];

/* ───────── Opening packs ───────── */

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

/** How exciting a pulled card is; packs reveal from least to most. */
export function hitRank(c: Card): number {
  const rarity: Record<Rarity, number> = { C: 0, UC: 1, PR: 1, R: 2, L: 3, SR: 4, SEC: 5, TR: 6 };
  const variant: Record<Variant, number> = {
    base: 0, reprint: 0, promo: 0, foil: 3, parallel: 10, special: 12, superParallel: 14, sp: 16, tr: 18, manga: 20,
  };
  return rarity[c.rarity] + variant[c.variant];
}

/** The pools a set actually has cards in; a slot's odds for an empty pool fall through to its fallback. */
function poolsOf(set: CardSet): Map<Pool, Card[]> {
  const m = new Map<Pool, Card[]>();
  for (const p of Object.keys(POOLS) as Pool[]) {
    const cards = set.cards.filter(POOLS[p]);
    if (cards.length) m.set(p, cards);
  }
  return m;
}

/** Which pool a slot position draws this time. */
function drawPool(slot: Slot, pools: Map<Pool, Card[]>, rng: Rng): Pool | null {
  let r = rng();
  for (const [pool, chance] of Object.entries(slot.odds ?? {}) as [Pool, number][]) {
    if ((r -= chance) < 0) return pools.has(pool) ? pool : (pools.has(slot.fallback) ? slot.fallback : null);
  }
  return pools.has(slot.fallback) ? slot.fallback : null;
}

/** Rolls one pack of `set` with its odds profile. Returns the cards in reveal order: the best card last. */
export function openPack(set: CardSet, rng: Rng = Math.random): Card[] {
  const pools = poolsOf(set);
  const pack: Card[] = [];
  const taken = new Set<string>();
  for (const slot of profileFor(set).slots) {
    for (let i = 0; i < slot.count; i++) {
      const pool = drawPool(slot, pools, rng);
      if (!pool) continue;
      // no card twice in one pack, unless its pool has run out
      const options = pools.get(pool)!.filter((c) => !taken.has(c.id));
      const from = options.length ? options : pools.get(pool)!;
      const card = from[Math.floor(rng() * from.length)];
      taken.add(card.id);
      pack.push(card);
    }
  }
  // stable sort keeps the slot order among equals
  return pack.map((c, i) => ({ c, i })).sort((a, b) => hitRank(a.c) - hitRank(b.c) || a.i - b.i).map((x) => x.c);
}

/** Expected cards per box from each pool, for the odds table. Pools the set has no cards in are left out. */
export function expectedPerBox(set: CardSet): { pool: Pool; perBox: number }[] {
  const pools = poolsOf(set);
  const profile = profileFor(set);
  const total = new Map<Pool, number>();
  const add = (p: Pool, n: number) => total.set(p, (total.get(p) ?? 0) + n);
  for (const slot of profile.slots) {
    let fallback = 1;
    for (const [pool, chance] of Object.entries(slot.odds ?? {}) as [Pool, number][]) {
      fallback -= chance;
      add(pools.has(pool) ? pool : slot.fallback, chance * slot.count * profile.boxPacks);
    }
    add(slot.fallback, Math.max(0, fallback) * slot.count * profile.boxPacks);
  }
  return [...total].filter(([p]) => pools.has(p)).map(([pool, n]) => ({ pool, perBox: n }));
}
