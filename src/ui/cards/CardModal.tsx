import { useEffect, useRef, type ReactNode } from 'react';
import type { Card } from '../../domain/cards';
import { CardFace, rarityText, toneOf } from './CardArt';

/**
 * A card shown big, over the Treasury page: art on one side, details and actions on the other.
 * ←/→ step through the list it was opened from; Esc closes it (and only it).
 */
export function CardModal({ card, onClose, prev, next, missing, children }: {
  card: Card;
  onClose: () => void;
  prev?: () => void;
  next?: () => void;
  /** Not in the binder yet: the art is dimmed. */
  missing?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tone = toneOf(card);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowLeft' && prev) { e.stopPropagation(); prev(); }
      if (e.key === 'ArrowRight' && next) { e.stopPropagation(); next(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, prev, next]);

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${card.name}, ${rarityText(card)}`}
        className="scroll-thin relative max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-cream-50 p-5 shadow-soft outline-none sm:max-w-2xl sm:rounded-2xl">
        <div className="absolute right-3 top-3 flex gap-1">
          {(prev || next) && <>
            <button className="btn btn-ghost px-2" onClick={prev} disabled={!prev} aria-label="Previous card">‹</button>
            <button className="btn btn-ghost px-2" onClick={next} disabled={!next} aria-label="Next card">›</button>
          </>}
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className={`w-52 shrink-0 sm:w-64 ${missing ? 'opacity-40 grayscale' : ''}`}>
            <CardFace card={card} className={missing ? '' : tone === 'legend' ? 'tcg-hit-legend' : tone === 'glow' ? 'tcg-hit-glow' : ''} />
          </div>
          <div className="w-full min-w-0 space-y-3 sm:pt-6">
            <div>
              <h3 className="font-serif text-xl font-semibold">{card.name}</h3>
              <p className={`text-sm ${tone === 'legend' ? 'text-moss-400' : tone === 'glow' ? 'text-sky-500' : 'text-ink-500'}`}>{rarityText(card)}</p>
              <p className="text-sm text-ink-500">{card.number} · {card.type} · {card.color}</p>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
