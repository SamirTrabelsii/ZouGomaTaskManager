import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { cardSet, type Card } from '../../domain/cards';
import { profileFor } from '../../domain/odds';
import { isBigPull, revealTier } from '../../domain/reveal';
import { bestInPack, PRICES } from '../../domain/shop';
import { CardThumb } from './CardArt';
import { BoosterArt } from './Shop';
import { Burst } from './fx';
import { useSfx } from './sfx';

/** Time between two packs in the fast "open all", and the pause before its summary, in ms. */
const RIP_STEP = 120;
const RIP_TAIL = 1000;

/**
 * A box bought whole, on screen: lift the lid, then pick its packs one by one (each opens with the full reveal and
 * comes back here), or rip them all in a fast montage whose big pulls fly up to a showcase, then one summary.
 * It stays mounted (hidden) while a pack is being revealed, so it comes back exactly as it was.
 */
export function BoxOpening() {
  const box = useStore((s) => s.boxReveal);
  const revealing = useStore((s) => !!s.packReveal);
  if (!box) return null;
  return <Box key={box.boxId} boxId={box.boxId} setId={box.setId} hidden={revealing} />;
}

/** Cards still flying to the showcase when the summary takes over (or the box closes). */
const clearGhosts = () => document.querySelectorAll('body > .tcg-shelf-card').forEach((g) => g.remove());


function Box({ boxId, setId, hidden }: { boxId: string; setId: string; hidden: boolean }) {
  const st = useStore.getState();
  const sealed = useStore((s) => s.data.cards.sealed);
  const reduce = useStore((s) => s.data.prefs.scene.reduceMotion);
  const soundOn = useStore((s) => s.data.prefs.scene.sound);
  const sfx = useSfx();
  const set = cardSet(setId);
  const slots = set ? profileFor(set).boxPacks : 24;
  const packs = sealed.filter((p) => p.boxId === boxId);
  // once the lid is up it stays up, even after the last pack is taken
  const [lid, setLid] = useState<'closed' | 'opening' | 'open'>(packs.length < slots ? 'open' : 'closed');
  const [lifting, setLifting] = useState<string | null>(null);
  const [montage, setMontage] = useState(false);
  const [ripped, setRipped] = useState<string[]>([]);
  const [hits, setHits] = useState<{ packId: string; card: Card }[]>([]);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const shelf = useRef<HTMLDivElement>(null);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { if (!hidden) root.current?.focus(); }, [hidden]);

  // the montage only animates: the packs stay sealed until the summary opens them all at once
  const shown = packs;
  const ids = packs.map((p) => p.id);
  const close = () => st.closeBox();

  const lift = () => {
    if (lid !== 'closed') return;
    sfx('lid');
    if (reduce) return setLid('open');
    setLid('opening');
    later(950, () => setLid('open'));
  };

  const pick = (id: string) => {
    if (lid !== 'open' || montage || lifting) return;
    sfx('slide');
    setLifting(id);
    later(reduce ? 0 : 380, () => { setLifting(null); st.openSealedPack(id); });
  };

  /** Rips every pack left, one after another, then shows them all in one summary. */
  const openAll = () => {
    if (lid !== 'open' || montage || !ids.length) return;
    if (reduce) return st.openSealedPacks(ids);
    setMontage(true);
    const order = [...packs];
    order.forEach((p, i) => later(i * RIP_STEP, () => {
      setRipped((r) => [...r, p.id]);
      sfx('rip');
      const best = bestInPack(p);
      if (best && isBigPull(best)) {
        setHits((h) => [...h, { packId: p.id, card: best }]);
        const tier = revealTier(best);
        later(150, () => sfx(tier === 'chase' ? 'chase' : tier === 'secret' ? 'secret' : 'super'));
      }
    }));
    later(order.length * RIP_STEP + RIP_TAIL, () => {
      clearGhosts();
      st.openSealedPacks(order.map((p) => p.id));
      setMontage(false);
      setRipped([]);
    });
  };

  const skip = () => {
    clearGhosts();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setMontage(false);
    setRipped([]);
    if (ids.length) st.openSealedPacks(ids);
  };

  // each big pull flies from its pack up to its place on the showcase shelf
  const flown = useRef(0);
  useLayoutEffect(() => {
    const row = shelf.current;
    if (!row || hits.length <= flown.current) return;
    for (; flown.current < hits.length; flown.current++) {
      const h = hits[flown.current];
      const slot = row.querySelector<HTMLElement>(`[data-hit="${h.packId}"]`);
      const from = root.current?.querySelector<HTMLElement>(`[data-pack="${h.packId}"]`)?.getBoundingClientRect();
      if (!slot || !from) { slot?.classList.add('is-landed'); continue; }
      const to = slot.getBoundingClientRect();
      const ghost = slot.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, { position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, margin: '0', zIndex: '70', pointerEvents: 'none', opacity: '1' });
      document.body.appendChild(ghost);
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      ghost.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(.5) rotate(10deg)`, opacity: 0 }, { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 50}px) scale(1.3) rotate(-4deg)`, opacity: 1, offset: 0.45 },
          { transform: 'translate(0,0) scale(1)', opacity: 1 }],
        { duration: 650, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
      ).onfinish = () => { ghost.remove(); slot.classList.add('is-landed'); };
    }
  }, [hits]);
  useEffect(() => clearGhosts, []);

  const emptySlots = Math.max(0, slots - shown.length);
  const kind = set?.kind ?? 'booster';

  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${setId} booster box`} hidden={hidden}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (montage) skip(); else close(); } }}
      className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_50%_35%,#1d2a63,#05070f_75%)] px-4 pb-8 pt-16 outline-none">
      <div className="absolute left-4 top-3 text-sm">
        <div className="font-serif text-lg font-semibold">{set?.name ?? setId}</div>
        <div className="text-xs text-ink-500">{PRICES[kind].label} box · {packs.length} of {slots} packs left</div>
      </div>
      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {montage && <button className="btn" onClick={skip}>Skip to all cards</button>}
        <button className="btn btn-ghost px-2" aria-pressed={!soundOn} aria-label={soundOn ? 'Mute sounds' : 'Turn sounds on'} title={soundOn ? 'Mute sounds' : 'Turn sounds on'}
          onClick={() => st.updatePrefs((p) => ({ ...p, scene: { ...p.scene, sound: !p.scene.sound } }))}>{soundOn ? '🔊' : '🔇'}</button>
        <button className="btn btn-ghost px-2" onClick={close} aria-label="Close the box">✕</button>
      </div>

      {/* the showcase: big pulls land here during the fast open */}
      <div ref={shelf} aria-live="polite" className={`mb-4 flex min-h-[5.5rem] flex-wrap items-end justify-center gap-2 transition-opacity ${hits.length ? 'opacity-100' : 'opacity-0'}`}>
        {hits.map((h) => (
          <div key={h.packId} data-hit={h.packId} className="tcg-shelf-card w-12 sm:w-14" title={h.card.name}><CardThumb id={h.card.id} /></div>
        ))}
      </div>

      <div className="tcg-box w-[min(94vw,46rem)]">
        <div className="tcg-box-tray">
          <ul className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 sm:gap-2.5">
            {shown.map((p) => {
              const torn = ripped.includes(p.id);
              return (
                <li key={p.id} data-pack={p.id} className="relative">
                  <button disabled={lid !== 'open' || montage} onClick={() => pick(p.id)} aria-label={`Open this ${setId} pack`}
                    className={`tcg-box-pack block w-full ${lifting === p.id ? 'is-lifting' : ''} ${torn ? 'is-ripped' : ''}`}>
                    <BoosterArt setId={setId} />
                  </button>
                  {torn && <Burst kind="tear" count={6} y={10} spread={50} />}
                </li>
              );
            })}
            {Array.from({ length: emptySlots }, (_, i) => <li key={`empty-${i}`} aria-hidden className="tcg-box-slot" />)}
          </ul>
        </div>
        {lid !== 'open' && (
          <button onClick={lift} aria-label="Lift the lid" className={`tcg-box-lid tcg-box-lid-${kind} ${lid === 'opening' ? 'is-opening' : ''}`}>
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center sm:gap-3">
              <div className="w-16 -rotate-6 sm:w-24"><BoosterArt setId={setId} /></div>
              <div className="text-[10px] font-semibold uppercase tracking-[.35em] opacity-80 sm:text-xs">One Piece Card Game · {setId}</div>
              <div className="font-serif text-2xl font-bold uppercase leading-none sm:text-4xl">{set?.name ?? setId}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-75 sm:text-xs">{PRICES[kind].label} box · {slots} packs</div>
            </div>
          </button>
        )}
        {lid === 'opening' && <><div aria-hidden className="tcg-box-glow" /><Burst kind="gold" count={24} y={20} spread={260} /></>}
      </div>

      <div className="mt-5 flex flex-col items-center gap-2 text-center">
        {lid !== 'open' ? <p className="text-sm text-ink-500">Tap the box to lift the lid</p>
          : montage ? <p className="text-sm text-ink-500">Ripping {ripped.length} of {packs.length}…</p>
            : packs.length ? (
              <>
                <p className="text-sm text-ink-500">Pick a pack for the full reveal, or rip them all at once.</p>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={openAll}>⚡ Open all {packs.length}</button>
                  <button className="btn" onClick={close}>Later</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-500">The box is empty. Every card is in your binder.</p>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => { close(); st.showBinderSet(setId); }}>Open the binder</button>
                  <button className="btn" onClick={close}>Done</button>
                </div>
              </>
            )}
      </div>
    </div>
  );
}
