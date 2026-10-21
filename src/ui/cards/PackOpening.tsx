import { useCallback, useEffect, useRef, useState } from 'react';
import { RARITY_LABEL, type Rarity } from '../../domain/cards';
import { useStore } from '../../state/store';
import { cardSet, type Card } from '../../domain/cards';
import { CardBack, CardFace, CardThumb, preloadCards, rarityText, toneOf } from './CardArt';
import { BoosterArt } from './Shop';

type Phase = 'sealed' | 'tearing' | 'reveal' | 'summary';

/**
 * Full-screen pack opening: tear the wrapper, flip the cards one by one (best last), then a summary.
 * The cards are already in the collection when this opens, so closing at any point loses nothing.
 */
export function PackOpening() {
  const reveal = useStore((s) => s.packReveal);
  if (!reveal) return null;
  // a new pack remounts the overlay so every reveal starts sealed
  return <Opening key={reveal.packId} />;
}

function Opening() {
  const reveal = useStore((s) => s.packReveal)!;
  const sealedLeft = useStore((s) => s.data.cards.sealed.length);
  const reduce = useStore((s) => s.data.prefs.scene.reduceMotion);
  const viaServer = useStore((s) => s.cloud.enabled && !!s.cloud.email);
  const st = useStore.getState();
  const quick = reveal.packs > 1;
  // several packs at once skip the tear and the flips: straight to what came out
  const [phase, setPhase] = useState<Phase>(quick ? 'summary' : 'sealed');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [flash, setFlash] = useState(0);
  const set = cardSet(reveal.setId);
  const cards = reveal.cards;
  const card: Card | undefined = cards[index];
  const isNew = (c: Card, i: number) => reveal.fresh.includes(c.id) && cards.findIndex((x) => x.id === c.id) === i;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!quick) preloadCards(cards, viaServer); }, [cards, viaServer, quick]);
  useEffect(() => { box.current?.focus(); }, [phase]);

  const tear = useCallback(() => {
    if (phase !== 'sealed') return;
    if (reduce) return setPhase('reveal');
    setPhase('tearing');
    setTimeout(() => setPhase('reveal'), 900);
  }, [phase, reduce]);

  /** One step: flip the current card, or move on to the next / the summary. */
  const advance = useCallback(() => {
    if (phase === 'sealed') return tear();
    if (phase !== 'reveal' || !card) return;
    if (!flipped) {
      setFlipped(true);
      if (toneOf(card) === 'legend') setFlash((n) => n + 1);
      return;
    }
    if (index + 1 >= cards.length) return setPhase('summary');
    setFlipped(false);
    setIndex(index + 1);
  }, [phase, card, flipped, index, cards.length, tear]);

  const close = () => st.closeReveal();
  // the next pack of the same set first, then whatever was bought earliest
  const sealed = useStore((s) => s.data.cards.sealed);
  const sameSet = sealed.filter((p) => p.setId === reveal.setId);
  const queue = sameSet.length ? sameSet : sealed;
  const openNext = () => { if (queue[0]) st.openSealedPack(queue[0].id); };
  const openRest = () => st.openSealedPacks(queue.map((p) => p.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if ((e.target as HTMLElement).tagName === 'BUTTON' && phase === 'summary') return;
        e.preventDefault();
        advance();
      }
      if (e.key === 'Escape') { e.stopPropagation(); if (phase === 'summary') close(); else setPhase('summary'); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const tone = card ? toneOf(card) : 'plain';
  const hits = cards.filter((c) => toneOf(c) === 'legend' || toneOf(c) === 'glow');

  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Opening a ${set?.name ?? ''} booster`}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_50%_40%,#1d2a63,#05070f_75%)] p-4 outline-none">
      {flash > 0 && <div key={flash} className="tcg-flash" aria-hidden />}
      <div className="absolute right-3 top-3 flex gap-2">
        {phase === 'reveal' && <button className="btn" onClick={() => setPhase('summary')}>Skip to all cards</button>}
        <button className="btn btn-ghost px-2" onClick={close} aria-label="Close pack opening">✕</button>
      </div>

      {(phase === 'sealed' || phase === 'tearing') && (
        <div className="flex flex-col items-center gap-5">
          <button onClick={tear} aria-label="Tear the pack open" className="w-48 sm:w-56">
            <BoosterArt setId={reveal.setId} className={`tcg-pack-wobble ${phase === 'tearing' ? 'is-torn' : ''}`} />
          </button>
          <p className="text-sm text-ink-500">{phase === 'sealed' ? 'Tap the pack to tear it open' : 'Tearing…'}</p>
        </div>
      )}

      {phase === 'reveal' && card && (
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <div className="text-xs uppercase tracking-widest text-ink-500">Card {index + 1} of {cards.length}</div>
          {/* keyed per card: the next card mounts face-down at once instead of flipping back and showing its face */}
          <button key={index} onClick={advance} aria-label={flipped ? 'Next card' : 'Flip the card'}
            className={`tcg-flip w-56 sm:w-64 ${flipped ? 'is-flipped' : ''}`} style={{ aspectRatio: '63 / 88' }}>
            <div className="tcg-flip-inner">
              <div className="tcg-face">
                <CardBack className={`h-full w-full ${!flipped && tone === 'legend' ? 'tcg-tease-legend' : !flipped && tone === 'glow' ? 'tcg-tease-glow' : ''}`} />
              </div>
              <div className="tcg-face tcg-face-front">
                <CardFace card={card} className={`h-full w-full ${tone === 'legend' ? 'tcg-hit-legend' : tone === 'glow' ? 'tcg-hit-glow' : ''}`} />
                {flipped && isNew(card, index) && (
                  <span className="tcg-pop absolute -right-2 -top-2 rounded-full bg-clay-500 px-2 py-0.5 text-xs font-bold text-white shadow-lg">NEW!</span>
                )}
              </div>
            </div>
          </button>
          <div className="h-12 text-center" aria-live="polite">
            {flipped && (
              <div className="tcg-pop">
                <div className="font-serif text-lg font-semibold">{card.name}</div>
                <div className={`text-sm ${tone === 'legend' ? 'text-moss-400' : tone === 'glow' ? 'text-sky-500' : 'text-ink-500'}`}>{rarityText(card)} · {card.number}</div>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-500">{flipped ? (index + 1 < cards.length ? 'Tap for the next card' : 'Tap to see them all') : 'Tap to flip'} · Space</p>
        </div>
      )}

      {phase === 'summary' && quick && (
        <QuickSummary cards={cards} fresh={reveal.fresh} packs={reveal.packs} title={set?.name ?? 'Your packs'}
          next={queue.length > 0 ? { one: openNext, rest: openRest, left: queue.length } : null} onClose={close} />
      )}

      {phase === 'summary' && !quick && (
        <div className="scroll-thin flex max-h-full w-full max-w-3xl flex-col items-center gap-4 overflow-y-auto overflow-x-hidden px-2 py-10">
          <h2 className="font-serif text-2xl font-semibold">{set?.name ?? 'Your pack'}</h2>
          <p className="text-sm text-ink-500">
            {reveal.fresh.length} new card{reveal.fresh.length === 1 ? '' : 's'}
            {hits.length > 0 && ` · best pull: ${cards[cards.length - 1].name} (${rarityText(cards[cards.length - 1])})`}
          </p>
          <ul className="grid w-full grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3">
            {cards.map((c, i) => <li key={`${c.id}-${i}`}><CardThumb id={c.id} isNew={isNew(c, i)} /></li>)}
          </ul>
          <div className="flex gap-2">
            {sealedLeft > 0 && <button className="btn btn-primary" onClick={openNext} autoFocus>Open next pack ({queue.length} left)</button>}
            {queue.length > 1 && <button className="btn" onClick={openRest}>⚡ Open all {queue.length}</button>}
            <button className="btn" onClick={close} autoFocus={sealedLeft === 0}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

const RARITY_ORDER: Rarity[] = ['TR', 'SEC', 'SR', 'L', 'R', 'UC', 'C', 'PR'];

/** Many packs at once: the hits big, what was new, and a count per rarity. Everything is a tap away. */
function QuickSummary({ cards, fresh, packs, title, next, onClose }: {
  cards: Card[];
  fresh: string[];
  packs: number;
  title: string;
  next: { one: () => void; rest: () => void; left: number } | null;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const freshSet = new Set(fresh);
  // cards come best first; a hit pulled twice shows once
  const hits = cards.filter((c, i) => (toneOf(c) === 'legend' || toneOf(c) === 'glow') && cards.findIndex((x) => x.id === c.id) === i);
  const counts = RARITY_ORDER.map((r) => ({ r, n: cards.filter((c) => c.rarity === r).length })).filter((x) => x.n);
  const shown = all ? cards : hits;
  return (
    <div className="scroll-thin flex max-h-full w-full max-w-4xl flex-col items-center gap-4 overflow-y-auto overflow-x-hidden px-2 py-10">
      <h2 className="font-serif text-2xl font-semibold">{title}</h2>
      <p className="text-center text-sm text-ink-500">
        {packs} packs · {cards.length} cards · <b className="text-moss-400">{fresh.length} new</b> for your binder
      </p>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {counts.map(({ r, n }) => <li key={r} className="chip">{RARITY_LABEL[r]} <b className="tabular-nums">{n}</b></li>)}
      </ul>
      <h3 className="label mb-0 mt-2">{all ? 'Every card, best first' : hits.length ? `Best pulls (${hits.length})` : 'No big hits this time'}</h3>
      <ul className="grid w-full grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3 md:grid-cols-6">
        {shown.map((c, i) => <li key={`${c.id}-${i}`}><CardThumb id={c.id} isNew={freshSet.has(c.id) && cards.findIndex((x) => x.id === c.id) === i} /></li>)}
      </ul>
      {!all && <button className="text-sm text-sky-500 hover:underline" onClick={() => setAll(true)}>Show all {cards.length} cards</button>}
      <div className="flex flex-wrap justify-center gap-2">
        {next && <button className="btn btn-primary" onClick={next.one} autoFocus>Open next pack ({next.left} left)</button>}
        {next && next.left > 1 && <button className="btn" onClick={next.rest}>⚡ Open all {next.left}</button>}
        <button className="btn" onClick={onClose} autoFocus={!next}>Done</button>
      </div>
    </div>
  );
}
