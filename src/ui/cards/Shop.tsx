import { useState } from 'react';
import { useStore } from '../../state/store';
import { useCatalog } from '../../state/catalog';
import { cardSet, PACK } from '../../domain/cards';
import { LOCALE } from '../../domain/dates';
import { balance, formatBerries } from '../../domain/economy';
import { PACK_PRICE, productsFor, setProgress, shopSets } from '../../domain/shop';
import { ConfirmButton, ProgressBar } from '../common/ui';

/** A booster wrapper drawn entirely in CSS (no card art), sized with its container; the top strip tears off when opened. */
export function BoosterArt({ setId, className = '' }: { setId: string; className?: string }) {
  const set = cardSet(setId);
  return (
    <div className={`tcg-pack ${className}`}>
      <div className="tcg-pack-top"><div className="tcg-pack-crimp top-0" style={{ height: '50%' }} /></div>
      <div className="tcg-pack-emblem" aria-hidden>{'⚓︎'}</div>
      <div className="absolute inset-x-[6%] bottom-[11%] text-center leading-tight">
        <div className="tcg-pack-code">{setId}</div>
        {/* long names ("The World's Strongest Warriors") shrink to stay on the wrapper */}
        <div className="tcg-pack-name font-serif" style={(set?.name.length ?? 0) > 22 ? { fontSize: '8.5cqw' } : (set?.name.length ?? 0) > 14 ? { fontSize: '10cqw' } : undefined}>{set?.name}</div>
        <div className="tcg-pack-sub">Booster · {PACK.size} cards</div>
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
            <p className="text-xs text-ink-500">{set.id} · English booster, {PACK.size} cards per pack</p>
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
                    {p.packs === 1 ? `${PACK.size} cards` : `${p.packs} packs · ${p.packs * PACK.size} cards · ${Math.round((1 - p.price / (p.packs * PACK_PRICE)) * 100)}% off`}
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
      </section>
      <p className="text-[11px] leading-snug text-ink-400">
        Card data, prices and art: optcgapi.com{syncedAt ? `, updated ${new Date(syncedAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}` : ''}.
        One Piece and its card art are owned by Eiichiro Oda / Shueisha / Bandai; packs here are for fun and cost only
        Berries. Pull rates are estimates, not official odds.
      </p>
    </div>
  );
}
