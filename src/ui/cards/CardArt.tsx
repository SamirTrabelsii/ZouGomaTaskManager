import { useState } from 'react';
import { useStore } from '../../state/store';
import { cardById, cardImageUrl, RARITY_LABEL, type Card } from '../../domain/cards';

/** How loud a card's reveal is: plain (C/UC), shine (R), glow (Leader/SR), legend (SEC and every alternate art). */
export type Tone = 'plain' | 'shine' | 'glow' | 'legend';
export function toneOf(c: Card): Tone {
  if (c.variant !== 'base' || c.rarity === 'SEC') return 'legend';
  if (c.rarity === 'SR' || c.rarity === 'L') return 'glow';
  if (c.rarity === 'R') return 'shine';
  return 'plain';
}

export function rarityText(c: Card): string {
  const variant = c.variant === 'manga' ? ' · Manga' : c.variant === 'parallel' ? ' · Parallel' : c.variant === 'boxTopper' ? ' · Box topper' : '';
  return RARITY_LABEL[c.rarity] + variant;
}

/** Signed in, art comes through the server's cache; local-only mode loads it from optcgapi.com directly. */
export function useCardImage(id: string): string {
  const viaServer = useStore((s) => s.cloud.enabled && !!s.cloud.email);
  return cardImageUrl(id, viaServer);
}

/** Starts downloading art ahead of a reveal, so flips never show an empty frame. */
export function preloadCards(ids: string[], viaServer: boolean) {
  for (const id of ids) { const img = new Image(); img.src = cardImageUrl(id, viaServer); }
}

/** The card's face. While the art loads (or if it can't) it shows a framed name and rarity instead. */
export function CardFace({ card, foil = true, className = '' }: { card: Card; foil?: boolean; className?: string }) {
  const src = useCardImage(card.id);
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
