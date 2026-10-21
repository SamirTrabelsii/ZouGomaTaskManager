import { useStore } from '../../state/store';
import { cardSet, PACK } from '../../domain/cards';
import { balance, formatBerries } from '../../domain/economy';
import { PRODUCTS, setProgress } from '../../domain/shop';
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
        <div className="tcg-pack-name font-serif">{set?.name}</div>
        <div className="tcg-pack-sub">Booster · {PACK.size} cards</div>
      </div>
      <div className="tcg-pack-crimp bottom-0" />
    </div>
  );
}

/** The Treasury's Shop tab: buy boosters, open sealed packs, see set progress. */
export function ShopTab() {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const money = balance(data.ledger);
  const sealed = data.cards.sealed;

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
            <div className="text-xs text-ink-500">Ready to open</div>
          </div>
          <button className="btn btn-primary" onClick={() => st.openSealedPack(sealed[0].id)}>Open a pack</button>
        </section>
      )}

      {[...new Set(PRODUCTS.map((p) => p.setId))].map((setId) => {
        const set = cardSet(setId);
        const progress = setProgress(data, setId);
        return (
          <section key={setId} aria-label={`${setId} ${set?.name}`} className="space-y-3">
            <div className="flex gap-3">
              <div className="w-20 shrink-0"><BoosterArt setId={setId} /></div>
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-lg font-semibold">{set?.name}</h3>
                <p className="text-xs text-ink-500">{setId} · English booster, {PACK.size} cards per pack</p>
                <ProgressBar value={progress.owned / progress.total} label={`${set?.name} collection`} className="mt-2" />
                <p className="mt-1 text-xs text-ink-500">{progress.owned} of {progress.total} cards collected</p>
              </div>
            </div>
            <ul className="space-y-2">
              {PRODUCTS.filter((p) => p.setId === setId).map((p) => {
                const short = p.price - money;
                return (
                  <li key={p.id} className="card flex items-center gap-3">
                    <div className="flex-1">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-ink-500">
                        {p.packs === 1 ? `${PACK.size} cards` : `${p.packs} packs · ${p.packs * PACK.size} cards · ${Math.round((1 - p.price / (p.packs * PRODUCTS[0].price)) * 100)}% off`}
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
        );
      })}
      <p className="text-[11px] leading-snug text-ink-400">
        Card data and art: optcgapi.com. One Piece and its card art are owned by Eiichiro Oda / Shueisha / Bandai; packs here are
        for fun and cost only Berries. Pull rates are estimates, not official odds.
      </p>
    </div>
  );
}
