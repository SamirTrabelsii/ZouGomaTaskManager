import type { Card, Variant } from './cards';

/* ───────── How loud a card's reveal is in the pack opening ───────── */

/**
 * common: C, UC, promo · rare: R · super: SR, Leader, foil · secret: SEC, TR · chase: every alternate-art print
 * (parallel, super parallel, SP, manga, treasure, special).
 */
export type RevealTier = 'common' | 'rare' | 'super' | 'secret' | 'chase';
/** The holographic sheen a card gets when shown big: none, a soft shine, gold sparkle, rainbow, or a manga ink sheen. */
export type HoloPattern = 'none' | 'soft' | 'gold' | 'rainbow' | 'ink';

const CHASE = new Set<Variant>(['parallel', 'superParallel', 'sp', 'manga', 'tr', 'special']);

export function revealTier(c: Pick<Card, 'rarity' | 'variant'>): RevealTier {
  if (CHASE.has(c.variant)) return 'chase';
  if (c.rarity === 'SEC' || c.rarity === 'TR') return 'secret';
  if (c.rarity === 'SR' || c.rarity === 'L' || c.variant === 'foil') return 'super';
  if (c.rarity === 'R') return 'rare';
  return 'common';
}

export function holoPattern(c: Pick<Card, 'rarity' | 'variant'>): HoloPattern {
  if (c.variant === 'manga') return 'ink';
  if (c.variant === 'sp' || c.variant === 'tr' || c.variant === 'superParallel') return 'gold';
  if (c.variant === 'parallel' || c.variant === 'special') return 'rainbow';
  const tier = revealTier(c);
  return tier === 'secret' ? 'gold' : tier === 'super' || tier === 'rare' ? 'soft' : 'none';
}

/**
 * The suspense before a card turns over, and how long the turn takes, in ms. Commons flip at once; a chase card dims
 * the room and shakes first, then turns slowly.
 */
export const REVEAL_TIMING: Record<RevealTier, { charge: number; flip: number }> = {
  common: { charge: 0, flip: 420 },
  rare: { charge: 0, flip: 520 },
  super: { charge: 220, flip: 700 },
  secret: { charge: 600, flip: 850 },
  chase: { charge: 1100, flip: 1150 },
};
