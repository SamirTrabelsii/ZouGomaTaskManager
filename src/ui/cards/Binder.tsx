import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useCatalog } from '../../state/catalog';
import { cardSet, cardSets, type Card, type Rarity } from '../../domain/cards';
import { formatBerries } from '../../domain/economy';
import { binderCards, collectionStats, duplicates, sellValue, setProgress, showcaseCard } from '../../domain/shop';
import { ConfirmButton, EmptyState, ProgressBar, Segmented } from '../common/ui';
import { CardFace, rarityText, toneOf } from './CardArt';
import { BuySingle, CardModal, SellNote, SetBadge } from './CardModal';
import { BoosterArt } from './Shop';

type Show = 'all' | 'owned' | 'missing' | 'dupes';
type RarityFilter = 'any' | Rarity | 'alt';
const RARITY_CHIPS: { value: RarityFilter; label: string }[] = [
  { value: 'any', label: 'Any' }, { value: 'L', label: 'Leader' }, { value: 'C', label: 'C' }, { value: 'UC', label: 'UC' },
  { value: 'R', label: 'R' }, { value: 'SR', label: 'SR' }, { value: 'SEC', label: 'SEC' }, { value: 'TR', label: 'TR' }, { value: 'alt', label: '✨ Alt arts' },
];

const pct = (p: { owned: number; total: number }) => (p.total ? Math.round((p.owned / p.total) * 100) : 0);

/** The Treasury's Binder: the collection at a glance, a set list, and every card of a set in order. */
export function BinderPage() {
  const data = useStore((s) => s.data);
  const owned = data.cards.owned;
  const version = useCatalog((c) => c.version); // re-render when a newer catalog arrives
  const sets = useMemo(() => [...cardSets()].reverse(), [version]); // newest first
  const picked = useStore((s) => s.binderSetId);
  // with nothing picked, start on the newest set you own cards from
  const setId = (picked && sets.some((x) => x.id === picked) ? picked : sets.find((x) => x.cards.some((c) => owned[c.id]))?.id) ?? sets[0]?.id;
  const [onlyStarted, setOnlyStarted] = useState(false);
  const stats = collectionStats(data);
  if (!setId) return <p className="text-sm text-ink-500">The card catalog is loading…</p>;
  const pick = (id: string) => useStore.getState().showBinderSet(id);
  const listed = sets.filter((x) => !onlyStarted || x.id === setId || x.cards.some((c) => owned[c.id]));

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        <CollectionSummary stats={stats} />
        <label className="block lg:hidden">
          <span className="label">Set</span>
          <select className="input" value={setId} onChange={(e) => pick(e.target.value)}>
            {sets.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name} ({pct(setProgress(data, x.id))}%)</option>)}
          </select>
        </label>
        <nav aria-label="Sets" className="hidden lg:block">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="label mb-0">Sets</h3>
            <label className="flex items-center gap-1 text-xs text-ink-500">
              <input type="checkbox" checked={onlyStarted} onChange={(e) => setOnlyStarted(e.target.checked)} /> Started only
            </label>
          </div>
          <ul className="scroll-thin max-h-[60vh] space-y-0.5 overflow-y-auto pr-1">
            {listed.map((x) => {
              const p = setProgress(data, x.id);
              const active = x.id === setId;
              return (
                <li key={x.id}>
                  <button onClick={() => pick(x.id)} aria-current={active ? 'true' : undefined}
                    className={`w-full rounded-lg px-2 py-1.5 text-left transition ${active ? 'bg-moss-600/20 ring-1 ring-moss-500/50' : 'hover:bg-cream-200'}`}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate"><b className="font-semibold">{x.id}</b> <span className="text-ink-500">{x.name}</span></span>
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-ink-500"><SetBadge setId={x.id} />{p.owned ? `${pct(p)}%` : '–'}</span>
                    </div>
                    {p.owned > 0 && <ProgressBar value={p.owned / p.total} label={`${x.id} completion`} className="mt-1 [&>div]:h-1" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <SetBinder key={setId} setId={setId} />
    </div>
  );
}

function CollectionSummary({ stats }: { stats: ReturnType<typeof collectionStats> }) {
  const data = useStore((s) => s.data);
  return (
    <section aria-label="Your collection" className="rounded-2xl border border-cream-300 bg-cream-200/40 p-4">
      <h2 className="font-serif text-lg font-semibold">Your collection</h2>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><dd className="text-xl font-semibold tabular-nums">{stats.distinct}</dd><dt className="text-[11px] text-ink-500">cards</dt></div>
        <div><dd className="text-xl font-semibold tabular-nums">{stats.copies}</dd><dt className="text-[11px] text-ink-500">copies</dt></div>
        <div><dd className="text-xl font-semibold tabular-nums">{stats.sets}</dd><dt className="text-[11px] text-ink-500">sets</dt></div>
      </dl>
      {stats.dupes > 0 && (
        <ConfirmButton className="btn mt-3 w-full" confirmLabel={`Sell ${stats.dupes} for ${formatBerries(stats.dupeValue)}?`}
          onConfirm={() => useStore.getState().sellDuplicates(duplicates(data).map((d) => ({ id: d.card.id, count: d.extra })))}>
          Sell every duplicate · {formatBerries(stats.dupeValue)}
        </ConfirmButton>
      )}
    </section>
  );
}

function SetBinder({ setId }: { setId: string }) {
  const data = useStore((s) => s.data);
  const owned = data.cards.owned;
  const st = useStore.getState();
  const version = useCatalog((c) => c.version);
  const set = cardSet(setId)!;
  const [show, setShow] = useState<Show>('all');
  const [rarity, setRarity] = useState<RarityFilter>('any');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => binderCards(setId), [setId, version]);
  const q = query.trim().toLowerCase();
  const shown = all.filter((c) => {
    const n = owned[c.id] ?? 0;
    if (show === 'owned' && !n) return false;
    if (show === 'missing' && n) return false;
    if (show === 'dupes' && n < 2) return false;
    if (q && !c.name.toLowerCase().includes(q) && !c.number.toLowerCase().includes(q)) return false;
    if (rarity === 'alt') return c.variant !== 'base' && c.variant !== 'reprint';
    return rarity === 'any' || (c.rarity === rarity && c.variant === 'base');
  });
  const progress = setProgress(data, setId);
  const inSet = new Set(all.map((c) => c.id));
  const dupes = duplicates(data).filter((d) => inSet.has(d.card.id));
  const dupeCount = dupes.reduce((n, d) => n + d.extra, 0);
  const dupeValue = dupes.reduce((n, d) => n + d.extra * sellValue(d.card), 0);
  const counts: Record<Show, number> = {
    all: all.length,
    owned: all.filter((c) => owned[c.id]).length,
    missing: all.filter((c) => !owned[c.id]).length,
    dupes: all.filter((c) => (owned[c.id] ?? 0) > 1).length,
  };

  const i = openId ? shown.findIndex((c) => c.id === openId) : -1;
  const open = i >= 0 ? shown[i] : null;

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-center gap-4">
        <div className="w-14 shrink-0"><BoosterArt setId={setId} /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl font-semibold leading-tight">{set.name} <span className="text-base font-normal text-ink-500">{setId}</span> <SetBadge setId={setId} className="align-middle" /></h2>
          <div className="mt-1 flex items-center gap-3">
            <ProgressBar value={progress.total ? progress.owned / progress.total : 0} label={`${setId} completion`} className="max-w-xs flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-ink-500">{progress.owned} / {progress.total} · {pct(progress)}%</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => st.showShopSet(setId)}>🃏 Buy packs</button>
          {dupeCount > 0 && (
            <ConfirmButton className="btn" confirmLabel={`Sell ${dupeCount} for ${formatBerries(dupeValue)}?`}
              onConfirm={() => st.sellDuplicates(dupes.map((d) => ({ id: d.card.id, count: d.extra })))}>
              Sell {dupeCount} duplicates · {formatBerries(dupeValue)}
            </ConfirmButton>
          )}
        </div>
      </header>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Show" value={show} onChange={setShow}
            options={[
              { value: 'all', label: `All ${counts.all}` }, { value: 'owned', label: `Owned ${counts.owned}` },
              { value: 'missing', label: `Missing ${counts.missing}` }, { value: 'dupes', label: `Duplicates ${counts.dupes}` },
            ]} />
          <input className="input w-full py-1 sm:ml-auto sm:w-48" type="search" placeholder="Name or number" aria-label="Find a card"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div role="group" aria-label="Rarity" className="flex flex-wrap gap-1">
          {RARITY_CHIPS.map((r) => (
            <button key={r.value} aria-pressed={rarity === r.value} onClick={() => setRarity(r.value)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${rarity === r.value ? 'border-moss-500 bg-moss-600 text-white' : 'border-cream-300 hover:bg-cream-200'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="📒" title={progress.owned ? 'No cards match' : 'No cards from this set yet'}
          hint={progress.owned ? 'Try another filter.' : `Open ${setId} packs to start filling these pages.`}
          action={!progress.owned && <button className="btn btn-primary" onClick={() => st.showShopSet(setId)}>Go to the {setId} shop</button>} />
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
          {shown.map((c) => {
            const n = owned[c.id] ?? 0;
            return (
              <li key={c.id}>
                {n ? (
                  <button className="relative block w-full transition hover:-translate-y-0.5" onClick={() => setOpenId(c.id)}
                    aria-label={`${c.name}, ${rarityText(c)}, ${c.number}, you own ${n}`}>
                    <CardFace card={c} foil={toneOf(c) === 'legend'} />
                    {n > 1 && <span className="absolute bottom-1 right-1 rounded-full bg-black/75 px-1.5 text-[10px] font-bold text-white">×{n}</span>}
                  </button>
                ) : (
                  <button onClick={() => setOpenId(c.id)} aria-label={`Missing: ${c.number} ${rarityText(c)}`}
                    className={`tcg-card flex w-full flex-col items-center justify-center gap-0.5 border-2 border-dashed bg-cream-100/60 text-center transition hover:border-cream-300 hover:bg-cream-200/60 ${toneOf(c) === 'legend' ? 'border-moss-600/40' : 'border-cream-300/70'}`}>
                    <span className="text-[10px] text-ink-400">{c.number}</span>
                    <span className="px-1 text-[9px] leading-tight text-ink-400">{c.variant === 'base' ? c.rarity : rarityText(c).split(' · ')[1]}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <CardModal card={open} missing={!owned[open.id]} onClose={() => setOpenId(null)}
          prev={i > 0 ? () => setOpenId(shown[i - 1].id) : undefined}
          next={i < shown.length - 1 ? () => setOpenId(shown[i + 1].id) : undefined}>
          {owned[open.id] ? <OwnedDetail card={open} count={owned[open.id]} /> : (
            <div className="space-y-2">
              <p className="text-sm">Not in your binder yet. It comes in {setId} packs, or buy it on its own.</p>
              <BuySingle card={open} />
              <button className="btn" onClick={() => { setOpenId(null); st.showShopSet(setId); }}>Buy {setId} packs</button>
            </div>
          )}
        </CardModal>
      )}
    </div>
  );
}

function OwnedDetail({ card, count }: { card: Card; count: number }) {
  const st = useStore.getState();
  const value = sellValue(card);
  const extra = Math.max(0, count - 1);
  const onWall = useStore((s) => showcaseCard(s.data)?.id === card.id);
  const picked = useStore((s) => s.data.prefs.scene.showcase === card.id);
  const setShowcase = (id: string | null) => st.updatePrefs((p) => ({ ...p, scene: { ...p.scene, showcase: id } }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onWall
          ? <span className="chip border-moss-500/50 text-moss-400">🖼 On the wall in your room{picked ? '' : ' (your most valuable card)'}</span>
          : <button className="btn" onClick={() => setShowcase(card.id)}>🖼 Show it in the room</button>}
        {picked && <button className="text-xs text-sky-500 hover:underline" onClick={() => setShowcase(null)}>Show my most valuable card instead</button>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="card py-2"><dt className="label mb-0">You own</dt><dd className="text-lg font-semibold">{count}</dd></div>
        <div className="card py-2"><dt className="label mb-0">Sells for</dt><dd className="text-lg font-semibold">{formatBerries(value)}</dd></div>
      </dl>
      {extra > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => st.sellDuplicates([{ id: card.id, count: 1 }])}>Sell 1 · {formatBerries(value)}</button>
          {extra > 1 && (
            <ConfirmButton className="btn" confirmLabel={`Sell ${extra} for ${formatBerries(value * extra)}?`}
              onConfirm={() => st.sellDuplicates([{ id: card.id, count: extra }])}>
              Sell all {extra} duplicates · {formatBerries(value * extra)}
            </ConfirmButton>
          )}
        </div>
      ) : <p className="text-xs text-ink-500">Your only copy always stays in the binder. Duplicates can be sold.</p>}
      <SellNote card={card} />
    </div>
  );
}
