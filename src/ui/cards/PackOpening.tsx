import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { RARITY_LABEL, type Rarity } from '../../domain/cards';
import { useStore } from '../../state/store';
import { cardSet, type Card } from '../../domain/cards';
import { holoPattern, REVEAL_TIMING, revealTier, type RevealTier } from '../../domain/reveal';
import { CardBack, CardFace, CardThumb, preloadCards, rarityText, toneOf } from './CardArt';
import { BoosterArt } from './Shop';
import { Burst, useTilt } from './fx';

type Phase = 'sealed' | 'tearing' | 'reveal' | 'summary';

/**
 * Full-screen pack opening: tear the wrapper with a swipe, then work through the pile (flip the top card, throw it
 * aside; best last), then a summary. The cards are already in the collection when this opens, so closing at any
 * point loses nothing.
 */
export function PackOpening() {
  const reveal = useStore((s) => s.packReveal);
  if (!reveal) return null;
  // a new pack remounts the overlay so every reveal starts sealed
  return <Opening key={reveal.packId} />;
}

/** How far (as a share of the pack's width) a swipe must go before the strip tears off. */
const TEAR_AT = 0.45;
const THROW_AT = 70;

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
  const [charging, setCharging] = useState(false);
  const [thrown, setThrown] = useState<0 | 1 | -1>(0);
  /** The celebration after a big card turns over; keyed so each one replays. */
  const [fx, setFx] = useState<{ key: number; tier: RevealTier } | null>(null);
  const [shake, setShake] = useState(0);
  const busy = useRef(false);
  const set = cardSet(reveal.setId);
  const cards = reveal.cards;
  const card: Card | undefined = cards[index];
  const tier = card ? revealTier(card) : 'common';
  const timing = reduce ? { charge: 0, flip: 0 } : REVEAL_TIMING[tier];
  const isNew = (c: Card, i: number) => reveal.fresh.includes(c.id) && cards.findIndex((x) => x.id === c.id) === i;
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => { if (!quick) preloadCards(cards, viaServer); }, [cards, viaServer, quick]);
  useEffect(() => { box.current?.focus(); }, [phase]);

  const tear = useCallback(() => {
    if (phase !== 'sealed') return;
    if (reduce) return setPhase('reveal');
    setPhase('tearing');
    later(1000, () => setPhase('reveal'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduce]);

  /** Turns the top card over, after a pause and a shake that grow with its rarity. */
  const flip = useCallback(() => {
    if (!card || busy.current) return;
    busy.current = true;
    if (timing.charge) setCharging(true);
    later(timing.charge, () => {
      setCharging(false);
      setFlipped(true);
      later(timing.flip, () => {
        busy.current = false;
        if (tier === 'secret' || tier === 'chase') {
          setFx({ key: Date.now(), tier });
          if (!reduce) setShake((n) => n + 1);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, tier, timing.charge, timing.flip, reduce]);

  /** Throws the turned card off the pile (left or right) and brings up the next one. */
  const toss = useCallback((dir: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    setThrown(dir);
    setFx(null);
    later(reduce ? 0 : 300, () => {
      busy.current = false;
      setThrown(0);
      if (index + 1 >= cards.length) return setPhase('summary');
      setFlipped(false);
      setIndex(index + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cards.length, reduce]);

  /** One step, for a tap or Space: tear, flip, or throw the card to the right. */
  const advance = useCallback(() => {
    if (phase === 'sealed') return tear();
    if (phase !== 'reveal' || !card) return;
    if (!flipped) flip(); else toss(1);
  }, [phase, card, flipped, tear, flip, toss]);

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
      if (phase === 'reveal' && flipped && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); toss(e.key === 'ArrowLeft' ? -1 : 1); }
      if (e.key === 'Escape') { e.stopPropagation(); if (phase === 'summary') close(); else setPhase('summary'); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const hits = cards.filter((c) => toneOf(c) === 'legend' || toneOf(c) === 'glow');
  const spotlight = phase === 'reveal' && tier === 'chase' && (charging || (flipped && !!fx));

  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Opening a ${set?.name ?? ''} booster`}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#1d2a63,#05070f_75%)] p-4 outline-none">
      <div aria-hidden className={`tcg-spotlight ${spotlight ? 'is-on' : ''}`} />
      {fx && <div key={fx.key} className="tcg-flash" aria-hidden />}
      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {phase === 'reveal' && <button className="btn" onClick={() => setPhase('summary')}>Skip to all cards</button>}
        <button className="btn btn-ghost px-2" onClick={close} aria-label="Close pack opening">✕</button>
      </div>

      <div key={shake} className={`relative z-10 flex flex-col items-center ${shake ? 'tcg-shake' : ''}`}>
        {(phase === 'sealed' || phase === 'tearing') && <SealedPack setId={reveal.setId} torn={phase === 'tearing'} reduce={reduce} onTear={tear} />}

        {phase === 'reveal' && card && (
          <div className="flex w-full max-w-sm flex-col items-center gap-4">
            <div className={`text-xs uppercase tracking-widest text-ink-500 transition-opacity ${fx ? 'opacity-0' : ''}`}>Card {index + 1} of {cards.length}</div>
            <Pile key={index} card={card} tier={tier} left={cards.length - index - 1} flipped={flipped} charging={charging} thrown={thrown}
              flipMs={timing.flip} isNew={isNew(card, index)} fx={fx} reduce={reduce} onTap={advance} onThrow={toss} />
            <div className="h-12 text-center" aria-live="polite">
              {flipped && (
                <div className="tcg-pop">
                  <div className="font-serif text-lg font-semibold">{card.name}</div>
                  <div className={`text-sm ${tier === 'chase' || tier === 'secret' ? 'text-moss-400' : tier === 'super' ? 'text-sky-500' : 'text-ink-500'}`}>{rarityText(card)} · {card.number}</div>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-500">
              {flipped ? `Swipe it away${index + 1 < cards.length ? ' for the next card' : ' to see them all'} · tap · Space` : charging ? 'Something big…' : 'Tap to flip · Space'}
            </p>
          </div>
        )}
      </div>

      {phase === 'summary' && quick && (
        <QuickSummary cards={cards} fresh={reveal.fresh} packs={reveal.packs} title={set?.name ?? 'Your packs'}
          next={queue.length > 0 ? { one: openNext, rest: openRest, left: queue.length } : null} onClose={close} />
      )}

      {phase === 'summary' && !quick && (
        <div className="scroll-thin relative z-10 flex max-h-full w-full max-w-3xl flex-col items-center gap-4 overflow-y-auto overflow-x-hidden px-2 py-10">
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

/** The sealed pack: tilts toward the pointer; swipe across it (or tap) to tear the top strip off. */
function SealedPack({ setId, torn, reduce, onTear }: { setId: string; torn: boolean; reduce: boolean; onTear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  useTilt(ref, !reduce && !torn, 18);
  const setTear = (t: number) => ref.current?.style.setProperty('--tear', String(t));

  return (
    <div className="flex flex-col items-center gap-5">
      <div ref={ref} role="button" tabIndex={-1} aria-label="Tear the pack open"
        className={`tcg-tilt relative w-48 cursor-grab touch-none select-none sm:w-56 ${dragging ? 'cursor-grabbing' : ''}`}
        onPointerDown={(e) => { if (torn) return; drag.current = { x: e.clientX, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const t = Math.min(1, Math.abs(e.clientX - d.x) / ref.current.offsetWidth);
          if (t > 0.03) { d.moved = true; setDragging(true); }
          setTear(t);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d || !ref.current) return;
          const t = Math.abs(e.clientX - d.x) / ref.current.offsetWidth;
          // a tap tears too; a short swipe springs back
          if (!d.moved || t >= TEAR_AT) onTear(); else setTear(0);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); setTear(0); }}>
        <BoosterArt setId={setId} className={`${torn ? 'is-torn' : ''} ${dragging ? 'is-dragging' : ''}`} />
        {torn && !reduce && <><div aria-hidden className="tcg-pack-glow" /><Burst kind="tear" count={22} y={8} spread={170} /></>}
      </div>
      <p className="text-sm text-ink-500">{torn ? 'Tearing…' : 'Swipe across the top to tear it open · or tap'}</p>
    </div>
  );
}

/**
 * The pile of face-down cards. The top one hints at its rarity on its edge, charges up before a big flip, carries a
 * holographic sheen that follows the pointer once turned, and can be swiped off either side.
 */
function Pile({ card, tier, left, flipped, charging, thrown, flipMs, isNew, fx, reduce, onTap, onThrow }: {
  card: Card; tier: RevealTier; left: number; flipped: boolean; charging: boolean; thrown: 0 | 1 | -1; flipMs: number;
  isNew: boolean; fx: { key: number; tier: RevealTier } | null; reduce: boolean; onTap: () => void; onThrow: (dir: 1 | -1) => void;
}) {
  const tilt = useRef<HTMLDivElement>(null);
  const move = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; dx: number; moved: boolean } | null>(null);
  useTilt(tilt, flipped && !reduce);
  const pattern = holoPattern(card);
  // thrown: fly off the side it was swiped to, from wherever the drag left it
  useEffect(() => {
    const el = move.current;
    if (!el || !thrown) return;
    el.style.transition = reduce ? 'none' : 'transform .3s ease-in, opacity .3s ease-in';
    el.style.transform = `translateX(${thrown * 140}%) rotate(${thrown * 24}deg)`;
    el.style.opacity = '0';
  }, [thrown, reduce]);
  const place = (dx: number, animate: boolean) => {
    if (!move.current) return;
    move.current.style.transition = animate ? 'transform .25s ease-out' : 'none';
    move.current.style.transform = dx ? `translateX(${dx}px) rotate(${dx / 14}deg)` : '';
  };

  return (
    <div className="relative w-56 sm:w-64" style={{ aspectRatio: '63 / 88' }}>
      {fx && !reduce && <div key={`rays-${fx.key}`} aria-hidden className={`tcg-rays tcg-rays-${fx.tier}`} />}
      {/* the rest of the pile, peeking out underneath */}
      {Array.from({ length: Math.min(3, left) }, (_, k) => (
        <div key={k} aria-hidden className="absolute inset-0" style={{ transform: `translate(${(k + 1) * 3}px, ${(k + 1) * 4}px) rotate(${(k + 1) * 1.4}deg)`, zIndex: -1 - k }}>
          <CardBack className="h-full w-full opacity-90" />
        </div>
      ))}
      <div ref={move} className="absolute inset-0 touch-none select-none"
        onPointerDown={(e) => { drag.current = { x: e.clientX, dx: 0, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !flipped) return;
          d.dx = e.clientX - d.x;
          if (Math.abs(d.dx) > 6) d.moved = true;
          if (d.moved) place(d.dx, false);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (!d.moved) return onTap();
          if (Math.abs(d.dx) >= THROW_AT) onThrow(d.dx < 0 ? -1 : 1);
          else place(0, true);
        }}
        onPointerCancel={() => { drag.current = null; place(0, true); }}>
        <div ref={tilt} className="tcg-tilt h-full w-full">
          <button onClick={(e) => { if (e.detail === 0) onTap(); }} aria-label={flipped ? 'Next card' : 'Flip the card'}
            className={`tcg-flip h-full w-full ${flipped ? 'is-flipped' : ''} ${charging ? `tcg-charge tcg-charge-${tier}` : ''}`}
            style={{ ['--flip-ms' as string]: `${flipMs}ms` } as CSSProperties}>
            <div className="tcg-flip-inner">
              <div className="tcg-face">
                <CardBack className={`h-full w-full ${flipped ? '' : `tcg-hint-${tier}`}`} />
              </div>
              <div className="tcg-face tcg-face-front">
                <CardFace card={card} foil={false} className={`h-full w-full ${tier === 'chase' || tier === 'secret' ? 'tcg-hit-legend' : tier === 'super' ? 'tcg-hit-glow' : ''}`} />
                {pattern !== 'none' && <div aria-hidden className={`tcg-holo tcg-holo-${pattern}`} />}
                {flipped && isNew && (
                  <span className="tcg-new absolute -bottom-2 -right-2 rounded-full bg-clay-500 px-2 py-0.5 text-xs font-bold text-white shadow-lg">NEW!</span>
                )}
              </div>
            </div>
          </button>
        </div>
      </div>
      {fx && !reduce && <Burst key={`burst-${fx.key}`} kind={fx.tier === 'chase' ? 'rainbow' : 'gold'} count={fx.tier === 'chase' ? 34 : 22} spread={fx.tier === 'chase' ? 230 : 170} />}
      {flipped && isNew && !reduce && <Burst key={`new-${card.id}`} kind="stars" count={6} x={96} y={98} spread={46} />}
      {fx && (
        <div key={`banner-${fx.key}`} className={`tcg-banner tcg-banner-${fx.tier}`} aria-hidden>{rarityText(card)}</div>
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
