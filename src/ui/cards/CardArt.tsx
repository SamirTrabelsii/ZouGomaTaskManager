import { useState } from 'react';
import { useStore } from '../../state/store';
import { cardById, cardImageUrl, RARITY_LABEL, type Card, type Variant } from '../../domain/cards';

/** How loud a card's reveal is: plain (C/UC), shine (R), glow (Leader/SR/foil), legend (SEC, TR and every chase print). */
export type Tone = 'plain' | 'shine' | 'glow' | 'legend';
const REGULAR = new Set<Variant>(['base', 'reprint', 'promo']);
export function toneOf(c: Card): Tone {
  if (!REGULAR.has(c.variant) && c.variant !== 'foil') return 'legend';
  if (c.rarity === 'SEC' || c.rarity === 'TR') return 'legend';
  if (c.variant === 'foil' || c.rarity === 'SR' || c.rarity === 'L') return 'glow';
  if (c.rarity === 'R') return 'shine';
  return 'plain';
}

const VARIANT_LABEL: Record<Variant, string> = {
  base: '', parallel: 'Parallel', superParallel: 'Super Parallel', sp: 'SP', manga: 'Manga', tr: 'Treasure',
  special: 'Special', foil: 'Foil', reprint: 'Reprint', promo: 'Promo',
};

export function rarityText(c: Card): string {
  const variant = c.rarity === 'TR' && c.variant === 'tr' ? '' : VARIANT_LABEL[c.variant];
  return RARITY_LABEL[c.rarity] + (variant ? ` · ${variant}` : '');
}

/** Signed in, art comes through the server's cache; local-only mode loads it from optcgapi.com directly. */
export function useCardImage(card: Card): string {
  const viaServer = useStore((s) => s.cloud.enabled && !!s.cloud.email);
  return cardImageUrl(card.img, viaServer);
}

/** Starts downloading art ahead of a reveal, so flips never show an empty frame. */
export function preloadCards(cards: Card[], viaServer: boolean) {
  for (const c of cards) { const img = new Image(); img.src = cardImageUrl(c.img, viaServer); }
}

/** The card's face. While the art loads (or if it can't) it shows a framed name and rarity instead. */
export function CardFace({ card, foil = true, className = '' }: { card: Card; foil?: boolean; className?: string }) {
  const src = useCardImage(card);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const tone = toneOf(card);
  const foilClass = foil && tone !== 'plain' ? `tcg-foil ${tone === 'legend' ? 'tcg-foil-legend' : ''}` : '';
  return (
    <div className={`tcg-card bg-cream-200 ${foilClass} ${className}`}>
      {state !== 'ok' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 border-2 border-cream-300 p-2 text-center">
          <span className="text-[10px] text-ink-500">{card.number}</span>
          <span className="font-serif text-sm font-semibold leading-tight">{card.name}</span>
          <span className="text-[10px] text-ink-500">{state === 'error' ? 'Art unavailable' : rarityText(card)}</span>
        </div>
      )}
      <img src={src} alt={`${card.name}, ${rarityText(card)}`} draggable={false} loading="lazy"
        onLoad={() => setState('ok')} onError={() => setState('error')}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}

export function CardBack({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`tcg-card tcg-back ${className}`} />;
}

export function CardThumb({ id, isNew }: { id: string; isNew?: boolean }) {
  const card = cardById(id);
  if (!card) return null;
  const tone = toneOf(card);
  return (
    <div className="relative">
      <CardFace card={card} foil={tone === 'legend'} className={tone === 'legend' ? 'tcg-hit-legend' : tone === 'glow' ? 'tcg-hit-glow' : ''} />
      {isNew && <span className="absolute -right-1 -top-1 rounded-full bg-clay-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">NEW</span>}
    </div>
  );
}
