import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { useNight, webglAvailable } from '../state/hooks';
import type { SceneObjectId } from '../domain/types';
import { cardSets } from '../domain/cards';
import { rarityText } from './cards/CardArt';
import { showcaseCard } from '../domain/shop';
import { Overview } from './Overview';
import { DeskPanel } from './panels/DeskPanel';
import { BookshelfPanel } from './panels/BookshelfPanel';
import { PlantsPanel } from './panels/PlantsPanel';
import { CalendarPanel } from './panels/CalendarPanel';
import { NotesPanel } from './panels/NotesPanel';

const Scene = lazy(() => import('../scene/Scene'));

export const OBJECTS: { id: SceneObjectId; label: string; icon: string }[] = [
  { id: 'desk', label: 'Desk · Tasks', icon: '🖥️' },
  { id: 'bookshelf', label: 'Shelf · Projects', icon: '📚' },
  { id: 'plants', label: 'Plants · Habits', icon: '🌿' },
  { id: 'calendar', label: 'Calendar', icon: '🗓️' },
  { id: 'notebook', label: 'Notebook', icon: '📓' },
  { id: 'chest', label: 'Chest · Treasury', icon: '💰' },
];

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Panel({ id }: { id: SceneObjectId }) {
  switch (id) {
    case 'desk': return <DeskPanel />;
    case 'bookshelf': return <BookshelfPanel />;
    case 'plants': return <PlantsPanel />;
    case 'calendar': return <CalendarPanel />;
    case 'notebook': return <NotesPanel />;
    case 'chest': return null; // opens the Treasury dialog instead
  }
}

/** Object shortcuts: keyboard-accessible equivalents of clicking things in the room (and the 2D fallback's main UI). */
function Dock({ big }: { big?: boolean }) {
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  return (
    <nav aria-label="Room objects" className={`pointer-events-auto flex gap-1 rounded-2xl border border-cream-300 bg-cream-50/90 p-1 shadow-soft backdrop-blur-md ${big ? 'flex-wrap justify-center' : ''}`}>
      {OBJECTS.map((o) => (
        <button
          key={o.id} aria-pressed={selected === o.id} title={o.label}
          onClick={() => select(selected === o.id ? null : o.id)}
          onMouseEnter={() => hover(o.id)} onMouseLeave={() => hover(null)} onFocus={() => hover(o.id)} onBlur={() => hover(null)}
          className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm transition ${selected === o.id ? 'bg-moss-600 text-white' : 'hover:bg-cream-200'}`}
        >
          <span aria-hidden className="text-lg">{o.icon}</span>
          <span className={big ? '' : selected ? 'sr-only' : 'hidden xl:inline'}>{o.label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Under the framed card's close-up: which card it is. */
function ShowcaseCaption() {
  const card = useStore((s) => showcaseCard(s.data));
  const picked = useStore((s) => !!s.data.prefs.scene.showcase);
  if (!card) return null;
  return (
    <div className="pointer-events-auto rounded-xl border border-cream-300 bg-cream-50/90 px-3 py-1.5 text-center text-sm shadow-soft backdrop-blur-md">
      <b className="font-serif">{card.name}</b> <span className="text-ink-500">· {rarityText(card)} · {card.number}</span>
      <div className="text-[11px] text-ink-500">{picked ? 'Your pick for the wall' : 'Your most valuable card'}</div>
    </div>
  );
}

/** Opens the binder on the framed card's set, where any card can be put on the wall. */
function ChangeShowcase() {
  const card = useStore((s) => showcaseCard(s.data));
  if (!card) return null;
  const setId = cardSets().find((x) => x.cards.some((c) => c.id === card.id))?.id;
  return (
    <button className="btn pointer-events-auto bg-cream-50/90 shadow-soft" onClick={() => { const st = useStore.getState(); st.setLookAt(null); if (setId) st.showBinderSet(setId); else st.setTreasuryTab('binder'); }}>
      🖼 Change card
    </button>
  );
}

export function Home() {
  const mode = useStore((s) => s.data.prefs.scene.mode);
  const night = useNight();
  const selected = useStore((s) => s.selected);
  const lookAt = useStore((s) => s.lookAt);
  const [failed, setFailed] = useState(false);
  const [gl] = useState(webglAvailable);
  const use3d = mode === '3d' ? gl && !failed : mode === 'auto' && gl && !failed;
  const st = useStore.getState();

  useEffect(() => {
    if (!lookAt) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.getState().setLookAt(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lookAt]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${night ? 'bg-[radial-gradient(ellipse_at_50%_35%,#1d2a63,#080b1a_75%)]' : 'bg-[radial-gradient(ellipse_at_50%_30%,#f3e9d6,#d9c9aa)]'}`}>
      {use3d ? (
        <SceneBoundary onError={() => setFailed(true)}>
          <Suspense fallback={<div className="flex h-full items-center justify-center text-ink-500" role="status">Preparing your studio…</div>}>
            <div className="absolute inset-0" aria-label="Interactive 3D room. Use the object buttons to open each area without a pointer." role="application">
              <Scene onContextLost={() => setFailed(true)} />
            </div>
          </Suspense>
        </SceneBoundary>
      ) : (
        <div className="scroll-thin absolute inset-0 overflow-y-auto px-4 pb-24 pt-20 md:pr-[30rem]">
          <div className="mx-auto max-w-xl space-y-4 text-center">
            <h1 className="font-serif text-2xl font-semibold">Your studio</h1>
            <p className="text-sm text-ink-500">
              {mode === '2d' ? 'Simple 2D mode is on.' : failed ? '3D rendering stopped working, so here is the simple view.' : '3D graphics are unavailable here, so here is the simple view.'}{' '}
              Everything works the same.
            </p>
            <Dock big />
            {(mode !== '2d' && gl) && <button className="btn" onClick={() => { setFailed(false); st.updatePrefs((p) => ({ ...p, scene: { ...p.scene, mode: 'auto' } })); }}>Try 3D again</button>}
          </div>
        </div>
      )}

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute left-3 top-16"><Overview /></div>
        {use3d && (
          <div className={`absolute bottom-16 -translate-x-1/2 transition-[left] md:bottom-4 ${selected ? 'hidden md:block md:left-[calc((100%-28rem)/2)]' : 'left-1/2'}`}><Dock /></div>
        )}
        {use3d && (
          <>
          <button
          className="btn pointer-events-auto absolute bottom-[4.6rem] right-3 h-9 w-9 justify-center bg-cream-50/90 p-0 shadow-soft md:hidden"
          onClick={() => st.resetCamera()} title="Reset camera" aria-label="Reset camera"
        >⟲</button>
        <div className="absolute bottom-16 left-3 hidden md:bottom-4 md:flex gap-1">
            <button className="btn pointer-events-auto bg-cream-50/90 shadow-soft" onClick={() => st.resetCamera()} title="Reset camera">⟲ Reset view</button>
            <button className="btn pointer-events-auto bg-cream-50/90 shadow-soft" aria-pressed={night}
              onClick={() => st.updatePrefs((p) => ({ ...p, scene: { ...p.scene, theme: night ? 'day' : 'evening' } }))}>
              {night ? '☀ Day' : '🌙 Night'}
            </button>
          </div>
          </>
        )}
        {lookAt && (
          <div className="absolute bottom-32 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-20">
            {lookAt === 'showcase' && <ShowcaseCaption />}
            <div className="flex gap-2">
              <button className="btn btn-primary pointer-events-auto shadow-soft" onClick={() => st.setLookAt(null)} autoFocus>← Back to the room <span className="ml-1 text-xs opacity-70">Esc</span></button>
              {lookAt === 'showcase' && <ChangeShowcase />}
            </div>
          </div>
        )}
        {selected && <Panel id={selected} />}
      </div>
    </div>
  );
}

