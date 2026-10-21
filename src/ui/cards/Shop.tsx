import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useCatalog } from '../../state/catalog';
import { boxStyle, cardSet, packArt, type Card, type CardSet } from '../../domain/cards';
import { expectedPerBox, POOL_LABEL, profileFor, type OddsProfile, type Pool } from '../../domain/odds';
import { LOCALE } from '../../domain/dates';
import { balance, formatBerries } from '../../domain/economy';
import { chaseCards, PRICES, productsFor, sealedBySet, sellValue, setProgress, shopSets, type Product } from '../../domain/shop';
import { ConfirmButton, ProgressBar } from '../common/ui';
import { CardFace, rarityText, toneOf } from './CardArt';
import { CardModal, SellNote } from './CardModal';

/**
 * A set's booster pack, sized with its container; the top strip tears off when opened. It shows Bandai's official
 * pack picture, or a wrapper drawn in CSS for a set without one (or when the picture can't load).
 */
export function BoosterArt({ setId, className = '' }: { setId: string; className?: string }) {
  const viaServer = useStore((s) => s.cloud.enabled && !!s.cloud.email);
  const art = packArt(setId, viaServer);
  const [failed, setFailed] = useState<string | null>(null);
  if (art && failed !== art.src) return <RealPack setId={setId} art={art} className={className} onError={() => setFailed(art.src)} />;
  return <DrawnPack setId={setId} className={className} />;
}

function RealPack({ setId, art, className, onError }: { setId: string; art: NonNullable<ReturnType<typeof packArt>>; className: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [x0, y0, x1, y1] = art.box;
  // the picture is scaled so the pack, not its transparent canvas, fills the box
  const img = <img src={art.src} alt="" draggable={false} decoding="async" onLoad={() => setLoaded(true)} onError={onError} style={boxStyle(art.box)} />;
  return (
    <div role="img" aria-label={`${setId} ${cardSet(setId)?.name ?? ''} booster pack`}
      className={`tcg-pack tcg-pack-real ${loaded ? '' : 'is-loading'} ${className}`} style={{ aspectRatio: `${x1 - x0} / ${y1 - y0}` }}>
      <div className="tcg-pack-art tcg-pack-art-body">{img}</div>
      <div className="tcg-pack-art tcg-pack-art-top">{img}</div>
    </div>
  );
}

function DrawnPack({ setId, className }: { setId: string; className: string }) {
  const set = cardSet(setId);
  const profile = set ? profileFor(set) : null;
  return (
    <div className={`tcg-pack ${set?.kind === 'premium' ? 'tcg-pack-premium' : set?.kind === 'extra' ? 'tcg-pack-extra' : ''} ${className}`}>
      <div className="tcg-pack-top"><div className="tcg-pack-crimp top-0" style={{ height: '50%' }} /></div>
      <div className="tcg-pack-emblem" aria-hidden>{'⚓︎'}</div>
      <div className="absolute inset-x-[6%] bottom-[11%] text-center leading-tight">
        <div className="tcg-pack-code">{setId}</div>
        {/* long names ("The World's Strongest Warriors") shrink to stay on the wrapper */}
        <div className="tcg-pack-name font-serif" style={(set?.name.length ?? 0) > 22 ? { fontSize: '8.5cqw' } : (set?.name.length ?? 0) > 14 ? { fontSize: '10cqw' } : undefined}>{set?.name}</div>
        <div className="tcg-pack-sub">{profile?.name ?? 'Booster'} · {profile?.cards ?? 12} cards</div>
      </div>
      <div className="tcg-pack-crimp bottom-0" />
    </div>
  );
}

const pct = (p: { owned: number; total: number }) => (p.total ? Math.round((p.owned / p.total) * 100) : 0);

/** The Treasury's Shop: every set on a shelf, newest featured, and a page per set. */
export function ShopPage() {
  useCatalog((c) => c.version); // re-render when a newer catalog arrives
  const setId = useStore((s) => s.shopSetId);
  const set = setId ? cardSet(setId) : null;
  return set ? <SetPage key={set.id} set={set} /> : <ShopHome />;
}

function ShopHome() {
  const data = useStore((s) => s.data);
  const sets = shopSets();
  const [query, setQuery] = useState('');
  if (!sets.length) return <p className="text-sm text-ink-500">The card catalog is loading…</p>;
  const q = query.trim().toLowerCase();
  const matches = (x: CardSet) => !q || x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q);
  const sealed = new Map(sealedBySet(data).map((g) => [g.setId, g.ids.length]));
  const shelves: { title: string; sets: CardSet[] }[] = [
    { title: 'Boosters', sets: sets.filter((x) => x.kind === 'booster' && matches(x)) },
    { title: 'Extra and premium boosters', sets: sets.filter((x) => x.kind !== 'booster' && matches(x)) },
  ];

  return (
    <div className="space-y-8">
      <Inventory />
      <Featured set={sets[0]} />
      <section aria-label="All sets" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-serif text-xl font-semibold">All sets</h2>
          <input className="input w-full sm:w-64" type="search" placeholder="Find a set (OP-05, Wings…)" aria-label="Find a set"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {shelves.map((shelf) => shelf.sets.length > 0 && (
          <div key={shelf.title}>
            <h3 className="label">{shelf.title}</h3>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {shelf.sets.map((x) => <li key={x.id}><SetTile set={x} newest={x.id === sets[0].id} sealed={sealed.get(x.id) ?? 0} /></li>)}
            </ul>
          </div>
        ))}
        {shelves.every((s) => !s.sets.length) && <p className="text-sm text-ink-500">No set matches “{query}”.</p>}
      </section>
      <Credits />
    </div>
  );
}

function SetTile({ set, newest, sealed }: { set: CardSet; newest: boolean; sealed: number }) {
  const data = useStore((s) => s.data);
  const progress = setProgress(data, set.id);
  return (
    <button className="group block w-full text-left" onClick={() => useStore.getState().showShopSet(set.id)}
      aria-label={`${set.id} ${set.name}, ${pct(progress)}% collected${sealed ? `, ${sealed} sealed` : ''}`}>
      <div className="relative transition duration-200 group-hover:-translate-y-1 group-hover:drop-shadow-[0_10px_18px_rgba(0,0,0,.45)]">
        <BoosterArt setId={set.id} />
        {newest && <span className="absolute left-1.5 top-[18%] rounded-full bg-clay-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">NEW</span>}
        {sealed > 0 && <span className="absolute right-1.5 top-[18%] rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">📦 {sealed}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-1 text-xs">
        <span className="font-semibold">{set.id}</span>
        <span className="tabular-nums text-ink-500">{progress.owned ? `${pct(progress)}%` : ''}</span>
      </div>
      <div className="truncate text-xs text-ink-500">{set.name}</div>
      {progress.owned > 0 && <ProgressBar value={progress.owned / progress.total} label={`${set.id} collected`} className="mt-1 [&>div]:h-1" />}
    </button>
  );
}

/** Sealed packs waiting, grouped by set, each openable one by one or all at once. */
function Inventory({ setId }: { setId?: string }) {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const groups = sealedBySet(data).filter((g) => !setId || g.setId === setId);
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  if (!total) return null;
  const all = groups.flatMap((g) => g.ids);

  return (
    <section aria-label="Packs to open" className="rounded-2xl border border-moss-500/50 bg-moss-600/10 p-4 shadow-[0_0_30px_-12px_rgba(255,160,70,.6)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-semibold">{total} pack{total === 1 ? '' : 's'} ready to open</h2>
          <p className="text-xs text-ink-500">One at a time for the full reveal, or all at once for a quick summary.</p>
        </div>
        {!setId && groups.length > 1 && <button className="btn" onClick={() => st.openSealedPacks(all)}>⚡ Open all {total}</button>}
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-1 scroll-thin">
        {groups.map((g) => (
          <li key={g.setId} className="flex shrink-0 items-center gap-3 rounded-xl bg-cream-50/70 p-2 pr-3">
            <div className="relative w-14">
              <BoosterArt setId={g.setId} />
              {g.ids.length > 1 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-clay-500 px-1.5 text-[11px] font-bold text-white shadow">×{g.ids.length}</span>}
            </div>
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{g.setId} <span className="font-normal text-ink-500">{cardSet(g.setId)?.name}</span></div>
              <div className="flex gap-1.5">
                <button className="btn btn-primary py-1" onClick={() => st.openSealedPack(g.ids[0])}>Open</button>
                {g.ids.length > 1 && <button className="btn py-1" onClick={() => st.openSealedPacks(g.ids)} title="Skip the reveals and see every card at once">⚡ All {g.ids.length}</button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Featured({ set }: { set: CardSet }) {
  const data = useStore((s) => s.data);
  const profile = profileFor(set);
  const progress = setProgress(data, set.id);
  const chase = useMemo(() => chaseCards(set, 4), [set]);
  const [pack, box] = productsFor(set);
  return (
    <section aria-label={`New release: ${set.name}`}
      className="relative overflow-hidden rounded-3xl border border-cream-300 bg-[radial-gradient(ellipse_at_20%_20%,rgba(235,161,74,.22),transparent_55%),radial-gradient(ellipse_at_90%_90%,rgba(98,180,255,.16),transparent_55%)] p-5 sm:p-7">
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex items-end justify-center gap-3">
          <button className="w-32 shrink-0 -rotate-3 transition hover:rotate-0 sm:w-40" onClick={() => useStore.getState().showShopSet(set.id)} aria-label={`Open the ${set.name} page`}>
            <BoosterArt setId={set.id} className="tcg-pack-wobble" />
          </button>
          <ChaseFan cards={chase} />
        </div>
        <div className="space-y-3">
          <span className="rounded-full bg-clay-500 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">New release</span>
          <h2 className="font-serif text-3xl font-semibold leading-tight">{set.name}</h2>
          <p className="text-sm text-ink-500">{set.id} · {profile.name}, {profile.cards} cards per pack · {profile.confidence === 'medium' ? 'odds counted for this set' : 'estimated odds'}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Offer product={pack} set={set} compact />
            <Offer product={box} set={set} compact />
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>{progress.owned} of {progress.total} collected</span>
            <button className="font-medium text-sky-500 hover:underline" onClick={() => useStore.getState().showShopSet(set.id)}>Chase cards and odds →</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A few chase cards fanned beside the wrapper, to show what's in there. */
function ChaseFan({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <div className="relative hidden h-40 w-44 sm:block" aria-hidden>
      {cards.slice(0, 3).map((c, i) => (
        <div key={c.id} className="absolute bottom-0 w-24 origin-bottom transition"
          style={{ left: `${i * 34}px`, transform: `rotate(${(i - 1) * 9}deg) translateY(${i === 1 ? -6 : 0}px)`, zIndex: i === 1 ? 3 : 2 - i }}>
          <CardFace card={c} className={toneOf(c) === 'legend' ? 'tcg-hit-legend' : ''} />
        </div>
      ))}
    </div>
  );
}

/** A product with its price; buys it, or shows how far the balance is from it. */
function Offer({ product, set, compact }: { product: Product; set: CardSet; compact?: boolean }) {
  const money = useStore((s) => balance(s.data.ledger));
  const st = useStore.getState();
  const profile = profileFor(set);
  const packPrice = PRICES[set.kind].pack;
  const short = product.price - money;
  const isBox = product.kind === 'box';
  const saving = Math.round((1 - product.price / (product.packs * packPrice)) * 100);
  const buy = isBox
    ? <ConfirmButton className="btn btn-primary w-full" confirmLabel={`Spend ${formatBerries(product.price)}?`} onConfirm={() => st.buyProduct(product.id)}>Buy box · {formatBerries(product.price)}</ConfirmButton>
    : <button className="btn btn-primary w-full" onClick={() => st.buyProduct(product.id)}>Buy pack · {formatBerries(product.price)}</button>;

  return (
    <div className={`flex flex-col justify-between gap-2 rounded-xl border bg-cream-50/70 p-3 ${isBox ? 'border-moss-500/40' : 'border-cream-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{isBox ? `Box of ${product.packs}` : 'Single pack'}</div>
          <div className="text-xs text-ink-500">{isBox ? `${product.packs * profile.cards} cards` : `${profile.cards} cards`}{compact ? '' : isBox ? ' · the best odds at a chase card' : ' · one quick rip'}</div>
        </div>
        {isBox && saving > 0 && <span className="shrink-0 rounded-full bg-moss-600/25 px-2 py-0.5 text-[11px] font-semibold text-moss-400">Save {saving}%</span>}
      </div>
      {short > 0 ? (
        <div>
          <div className="mb-1 flex justify-between text-xs"><span className="font-semibold tabular-nums">{formatBerries(product.price)}</span><span className="text-ink-500">{formatBerries(short)} to go</span></div>
          <ProgressBar value={money / product.price} label={`Saved toward the ${isBox ? 'box' : 'pack'}`} className="[&>div]:h-1.5" />
          {!compact && <button className="mt-1.5 text-xs text-sky-500 hover:underline" onClick={() => st.setTreasuryTab('wallet')}>How to earn Berries →</button>}
        </div>
      ) : buy}
    </div>
  );
}

function SetPage({ set }: { set: CardSet }) {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const profile = profileFor(set);
  const progress = setProgress(data, set.id);
  const chase = useMemo(() => chaseCards(set, 12), [set]);
  const [zoom, setZoom] = useState<number | null>(null);
  const zoomed = zoom == null ? null : chase[zoom];
  const newest = shopSets()[0]?.id === set.id;

  return (
    <div className="space-y-6">
      <button className="text-sm text-sky-500 hover:underline" onClick={() => st.showShopSet(null)}>← All sets</button>

      <section className="grid gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="mx-auto w-40 md:w-full"><BoosterArt setId={set.id} className="tcg-pack-wobble" /></div>
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip">{set.id}</span>
              <span className="chip">{PRICES[set.kind].label}</span>
              {newest && <span className="rounded-full bg-clay-500 px-2 py-0.5 font-bold text-white">NEW</span>}
            </div>
            <h2 className="mt-2 font-serif text-3xl font-semibold leading-tight">{set.name}</h2>
            <p className="mt-1 text-sm text-ink-500">{profile.cards} cards per pack, {profile.boxPacks} packs per box · {set.cards.length} prints to collect</p>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span>{progress.owned} of {progress.total} in your binder</span>
              <button className="text-sky-500 hover:underline" onClick={() => st.showBinderSet(set.id)}>Open the binder →</button>
            </div>
            <ProgressBar value={progress.total ? progress.owned / progress.total : 0} label={`${set.name} collection`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {productsFor(set).map((p) => <Offer key={p.id} product={p} set={set} />)}
          </div>
        </div>
      </section>

      <Inventory setId={set.id} />

      {chase.length > 0 && (
        <section aria-label="Chase cards">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-serif text-lg font-semibold">Chase cards</h3>
            <span className="text-xs text-ink-500">The most valuable prints in this set</span>
          </div>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {chase.map((c, i) => {
              const owned = data.cards.owned[c.id] ?? 0;
              return (
                <li key={c.id}>
                  <button className="group relative block w-full text-left" onClick={() => setZoom(i)} aria-label={`${c.name}, ${rarityText(c)}${owned ? ', in your binder' : ''}`}>
                    <div className="transition group-hover:-translate-y-1"><CardFace card={c} foil={toneOf(c) === 'legend'} /></div>
                    {owned > 0 && <span className="absolute right-1 top-1 rounded-full bg-moss-600 px-1.5 text-[10px] font-bold text-white shadow">✓ Owned</span>}
                    <div className="mt-1 truncate text-xs font-medium">{c.name}</div>
                    <div className="truncate text-[11px] text-ink-500">{rarityText(c)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Odds set={set} profile={profile} />
      <Credits />

      {zoomed && (
        <CardModal card={zoomed} onClose={() => setZoom(null)}
          prev={zoom! > 0 ? () => setZoom(zoom! - 1) : undefined}
          next={zoom! < chase.length - 1 ? () => setZoom(zoom! + 1) : undefined}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="card py-2"><dt className="label mb-0">In your binder</dt><dd className="text-lg font-semibold">{data.cards.owned[zoomed.id] ?? 0}</dd></div>
            <div className="card py-2"><dt className="label mb-0">Sells for</dt><dd className="text-lg font-semibold">{formatBerries(sellValue(zoomed))}</dd></div>
          </dl>
          <SellNote card={zoomed} />
        </CardModal>
      )}
    </div>
  );
}

/** Commons, uncommons and other fillers aren't "odds" anyone asks about. */
const FILLER = new Set<Pool>(['C', 'UC', 'R', 'reprintLow', 'reprintR', 'foil']);

/** "3 per box", "1 in 8 packs", "1 per 2.5 boxes", "1 per case", "1 per 2 cases". */
export function rateText(perBox: number, boxPacks: number): string {
  if (perBox >= 1) return `${perBox >= 10 ? Math.round(perBox) : Math.round(perBox * 10) / 10} per box`;
  const boxes = 1 / perBox;
  if (boxes < 1.5) return `1 in ${Math.round(boxPacks / perBox)} packs`;
  if (boxes < 10) return `1 per ${Math.round(boxes * 2) / 2} boxes`;
  const cases = Math.round(boxes / 12 * 2) / 2;
  return cases <= 1 ? '1 per case' : `1 per ${cases} cases`;
}

/** What a box of this set gives on average, rarest last, with where the numbers come from. */
function Odds({ set, profile }: { set: CardSet; profile: OddsProfile }) {
  const rows = expectedPerBox(set).filter((r) => !FILLER.has(r.pool) && r.perBox > 0).sort((a, b) => b.perBox - a.perBox);
  return (
    <section aria-label="Pull rates">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-lg font-semibold">Pull rates <span className="text-sm font-normal text-ink-500">per box of {profile.boxPacks}</span></h3>
        <span className={`chip ${profile.confidence === 'medium' ? 'border-moss-500/50 text-moss-400' : ''}`}>{profile.confidence === 'medium' ? '✓ Counted for this set' : 'Estimate'}</span>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r, i) => (
          <li key={r.pool} className={`rounded-xl border p-3 ${i >= rows.length - 2 ? 'border-moss-500/40 bg-moss-600/10' : 'border-cream-300 bg-cream-200/30'}`}>
            <div className="text-xs text-ink-500">{POOL_LABEL[r.pool]}</div>
            <div className="font-semibold tabular-nums">{rateText(r.perBox, profile.boxPacks)}</div>
          </li>
        ))}
      </ul>
      <details className="mt-2 text-xs text-ink-500">
        <summary className="cursor-pointer">Where these numbers come from</summary>
        <p className="mt-1">{profile.note} A case is 12 boxes. Every pack also has commons, uncommons and rares.</p>
        <p className="mt-1">
          Sources:{' '}
          {profile.sources.map((src, i) => (
            <span key={src.url}>{i > 0 && ' · '}<a className="underline hover:text-ink-900" href={src.url} target="_blank" rel="noreferrer noopener">{src.label}</a></span>
          ))}
        </p>
      </details>
    </section>
  );
}

function Credits() {
  const syncedAt = useCatalog((c) => c.syncedAt);
  return (
    <p className="text-[11px] leading-snug text-ink-400">
      Card data, prices and art: optcgapi.com{syncedAt ? `, updated ${new Date(syncedAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}` : ''}.
      One Piece and its card art are owned by Eiichiro Oda / Shueisha / Bandai; packs here are for fun and cost only
      Berries. Pull rates are estimates, not official odds.
    </p>
  );
}
