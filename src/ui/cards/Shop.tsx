import { useState } from 'react';
import { useStore } from '../../state/store';
import { useCatalog } from '../../state/catalog';
import { cardSet, type CardSet } from '../../domain/cards';
import { expectedPerBox, POOL_LABEL, profileFor, type Pool } from '../../domain/odds';
import { LOCALE } from '../../domain/dates';
import { balance, formatBerries } from '../../domain/economy';
import { productsFor, setProgress, shopSets } from '../../domain/shop';
import { ConfirmButton, ProgressBar } from '../common/ui';

/** A booster wrapper drawn entirely in CSS (no card art), sized with its container; the top strip tears off when opened. */
export function BoosterArt({ setId, className = '' }: { setId: string; className?: string }) {
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

/** The Treasury's Shop tab: pick a set (newest first), buy its boosters, open sealed packs. */
export function ShopTab() {
  const data = useStore((s) => s.data);
  useCatalog((c) => c.version); // re-render when a newer catalog arrives
  const syncedAt = useCatalog((c) => c.syncedAt);
  const st = useStore.getState();
  const money = balance(data.ledger);
  const sealed = data.cards.sealed;
  const sets = shopSets();
  const [picked, setPicked] = useState<string | null>(null);
  const set = sets.find((x) => x.id === picked) ?? sets[0];
  if (!set) return <p className="text-sm text-ink-500">The card catalog is loading…</p>;
  const progress = setProgress(data, set.id);
  const products = productsFor(set);
  const profile = profileFor(set);
  const packPrice = products.find((p) => p.kind === 'pack')!.price;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-500">Your balance</span>
        <span className="font-serif text-xl font-semibold tabular-nums">{formatBerries(money)}</span>
      </div>

      {sealed.length > 0 && (
        <section aria-label="Sealed packs" className="card flex items-center gap-3 border-moss-500/50">
          <div className="w-12 shrink-0"><BoosterArt setId={sealed[0].setId} /></div>
          <div className="flex-1 text-sm">
            <div className="font-semibold">{sealed.length} sealed pack{sealed.length === 1 ? '' : 's'}</div>
            <div className="text-xs text-ink-500">Next: {cardSet(sealed[0].setId)?.name ?? sealed[0].setId}</div>
          </div>
          <button className="btn btn-primary" onClick={() => st.openSealedPack(sealed[0].id)}>Open a pack</button>
        </section>
      )}

      <label className="block">
        <span className="label">Set</span>
        <select className="input" value={set.id} onChange={(e) => setPicked(e.target.value)}>
          {sets.map((x, i) => <option key={x.id} value={x.id}>{x.id} · {x.name}{i === 0 ? ' (newest)' : ''}</option>)}
        </select>
      </label>

      <section aria-label={`${set.id} ${set.name}`} className="space-y-3">
        <div className="flex gap-3">
          <div className="w-20 shrink-0"><BoosterArt setId={set.id} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-lg font-semibold">{set.name}</h3>
            <p className="text-xs text-ink-500">{set.id} · {profile.name}, {profile.cards} cards per pack, {profile.boxPacks} per box</p>
            <ProgressBar value={progress.total ? progress.owned / progress.total : 0} label={`${set.name} collection`} className="mt-2" />
            <p className="mt-1 text-xs text-ink-500">{progress.owned} of {progress.total} cards collected</p>
          </div>
        </div>
        <ul className="space-y-2">
          {products.map((p) => {
            const short = p.price - money;
            return (
              <li key={p.id} className="card flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-ink-500">
                    {p.packs === 1 ? `${profile.cards} cards` : `${p.packs} packs · ${p.packs * profile.cards} cards · ${Math.round((1 - p.price / (p.packs * packPrice)) * 100)}% off`}
                  </div>
                </div>
                {short > 0 ? (
                  <span className="text-right text-xs text-ink-500">{formatBerries(p.price)}<br />need {formatBerries(short)} more</span>
                ) : p.kind === 'box' ? (
                  <ConfirmButton className="btn btn-primary" confirmLabel={`Spend ${formatBerries(p.price)}?`} onConfirm={() => st.buyProduct(p.id)}>
                    Buy · {formatBerries(p.price)}
                  </ConfirmButton>
                ) : (
                  <button className="btn btn-primary" onClick={() => st.buyProduct(p.id)}>Buy · {formatBerries(p.price)}</button>
                )}
              </li>
            );
          })}
        </ul>
        <OddsTable set={set} />
      </section>
      <p className="text-[11px] leading-snug text-ink-400">
        Card data, prices and art: optcgapi.com{syncedAt ? `, updated ${new Date(syncedAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}` : ''}.
        One Piece and its card art are owned by Eiichiro Oda / Shueisha / Bandai; packs here are for fun and cost only
        Berries. Pull rates are estimates, not official odds.
      </p>
    </div>
  );
}

/** Commons, uncommons and other fillers aren't "odds" anyone asks about. */
const FILLER = new Set<Pool>(['C', 'UC', 'R', 'reprintLow', 'reprintR', 'foil']);

/** "3 per box", "1 in 8 packs", "1 per 2.5 boxes", "1 per case", "1 per 2 cases". */
function rateText(perBox: number, boxPacks: number): string {
  if (perBox >= 1) return `${perBox >= 10 ? Math.round(perBox) : Math.round(perBox * 10) / 10} per box`;
  const boxes = 1 / perBox;
  if (boxes < 1.5) return `1 in ${Math.round(boxPacks / perBox)} packs`;
  if (boxes < 10) return `1 per ${Math.round(boxes * 2) / 2} boxes`;
  const cases = Math.round(boxes / 12 * 2) / 2;
  return cases <= 1 ? '1 per case' : `1 per ${cases} cases`;
}

/** What a box of this set gives on average, where the numbers come from, and how sure they are. */
function OddsTable({ set }: { set: CardSet }) {
  const profile = profileFor(set);
  const rows = expectedPerBox(set).filter((r) => !FILLER.has(r.pool) && r.perBox > 0).sort((a, b) => b.perBox - a.perBox);
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium">
        Odds <span className={`ml-1 chip ${profile.confidence === 'medium' ? 'text-moss-400' : ''}`}>{profile.confidence === 'medium' ? 'counted for this set' : 'estimate'}</span>
      </summary>
      <table className="mt-2 w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-500"><th className="font-medium">Per box ({profile.boxPacks} packs)</th><th className="text-right font-medium">Average</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pool}><td>{POOL_LABEL[r.pool]}</td><td className="text-right tabular-nums">{rateText(r.perBox, profile.boxPacks)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-500">{profile.note} A case is 12 boxes.</p>
      <p className="mt-1 text-xs text-ink-500">
        Sources:{' '}
        {profile.sources.map((src, i) => (
          <span key={src.url}>{i > 0 && ' · '}<a className="underline hover:text-ink-900" href={src.url} target="_blank" rel="noreferrer noopener">{src.label}</a></span>
        ))}
      </p>
    </details>
  );
}

