import { useEffect, useRef, type ReactNode } from 'react';
import { RARITY_LABEL, type Card } from '../../domain/cards';
import { balance, economyStart, formatBerries } from '../../domain/economy';
import { MARKET_FLOOR, MARKET_MULT, marketPrice, SELL_CAP, SELL_RATE, sellBreakdown, setCompletion } from '../../domain/shop';
import { useStore } from '../../state/store';
import { ConfirmButton, ProgressBar } from '../common/ui';
import { CardFace, rarityText, toneOf } from './CardArt';

/** Buys a card you're missing on the market (5× its sale value), or shows how far you are from it. */
export function BuySingle({ card }: { card: Card }) {
  const money = useStore((s) => balance(s.data.ledger));
  const started = useStore((s) => !!economyStart(s.data.ledger));
  const price = marketPrice(card);
  const short = price - money;
  const buy = () => useStore.getState().buyCard(card.id);
  if (!started) return null;
  return (
    <div className="rounded-xl border border-moss-500/40 bg-moss-600/10 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">🛒 On the market</span>
        <span className="font-serif text-lg font-semibold tabular-nums text-moss-400">{formatBerries(price)}</span>
      </div>
      {short > 0 ? (
        <div>
          <ProgressBar value={money / price} label="Saved toward this card" className="[&>div]:h-1.5" />
          <p className="mt-1 text-xs text-ink-500">{formatBerries(short)} to go.</p>
        </div>
      ) : price >= 500
        ? <ConfirmButton className="btn btn-primary w-full" confirmLabel={`Spend ${formatBerries(price)}?`} onConfirm={buy}>Buy this card · {formatBerries(price)}</ConfirmButton>
        : <button className="btn btn-primary w-full" onClick={buy}>Buy this card · {formatBerries(price)}</button>}
      <p className="mt-2 text-[11px] text-ink-500">A single costs {MARKET_MULT}× what it sells for, at least {formatBerries(MARKET_FLOOR[card.rarity])} for a {RARITY_LABEL[card.rarity]}.</p>
    </div>
  );
}

/** "✓ Complete" once you own every base card of a set, "★ Master" once you own every print. */
export function SetBadge({ setId, className = '' }: { setId: string; className?: string }) {
  const done = useStore((s) => setCompletion(s.data, setId));
  if (!done.base) return null;
  return done.master
    ? <span className={`rounded-full bg-[linear-gradient(90deg,#ff5f6d,#ffc371,#47c8f9,#b347f9)] px-1.5 py-0.5 text-[10px] font-bold text-white shadow ${className}`}>★ Master</span>
    : <span className={`rounded-full bg-moss-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow ${className}`}>✓ Complete</span>;
}

/** One line on how a card's sale price was worked out: market price, its rarity's minimum, or the cap. */
export function SellNote({ card }: { card: Card }) {
  const s = sellBreakdown(card);
  const price = card.price == null ? null : `$${card.price.toFixed(2)}`;
  let text: string;
  if (s.basis === 'cap') text = `Market price ≈ ${price}, capped at ${formatBerries(SELL_CAP)}: the most one card sells for.`;
  else if (s.basis === 'market') text = `Market price ≈ ${price} at the last sync, at ${formatBerries(SELL_RATE)} per $1.`;
  else text = `${price ? `Market price ≈ ${price} is worth ${formatBerries(s.market)}` : 'No market price yet'}, so the ${RARITY_LABEL[card.rarity]} minimum of ${formatBerries(s.floor)} applies.`;
  return <p className="text-xs text-ink-500">{text}</p>;
}

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
        className="scroll-thin relative max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-cream-50 p-5 shadow-soft outline-none sm:max-w-4xl sm:rounded-2xl">
        <div className="absolute right-3 top-3 flex gap-1">
          {(prev || next) && <>
            <button className="btn btn-ghost px-2" onClick={prev} disabled={!prev} aria-label="Previous card">‹</button>
            <button className="btn btn-ghost px-2" onClick={next} disabled={!next} aria-label="Next card">›</button>
          </>}
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          {/* big enough to read the card's text, never taller than the screen; no foil shine so the text stays clear */}
          <div className={`w-[min(80vw,22rem)] max-w-[calc((94vh-2.5rem)*0.716)] shrink-0 sm:w-80 lg:w-[26rem] ${missing ? 'opacity-40 grayscale' : ''}`}>
            <CardFace card={card} foil={false} />
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
