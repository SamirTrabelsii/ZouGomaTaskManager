import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { CARD_SETS, RARITY_LABEL, type Card, type Rarity } from '../../domain/cards';
import { formatBerries } from '../../domain/economy';
import { binderCards, duplicates, sellValue, setProgress } from '../../domain/shop';
import { ConfirmButton, EmptyState, ProgressBar, Segmented } from '../common/ui';
import { CardFace, rarityText, toneOf } from './CardArt';

type Show = 'all' | 'owned' | 'missing' | 'dupes';
type RarityFilter = 'any' | Rarity | 'alt';

/** The Treasury's Binder tab: every card of a set in order, owned ones with art, missing ones as empty slots. */
export function BinderTab() {
  const data = useStore((s) => s.data);
  const owned = data.cards.owned;
  const st = useStore.getState();
  const [setId, setSetId] = useState(CARD_SETS[0].id);
  const [show, setShow] = useState<Show>('all');
  const [rarity, setRarity] = useState<RarityFilter>('any');
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => binderCards(setId), [setId]);
  const shown = all.filter((c) => {
    const n = owned[c.id] ?? 0;
    if (show === 'owned' && !n) return false;
    if (show === 'missing' && n) return false;
    if (show === 'dupes' && n < 2) return false;
    if (rarity === 'alt') return c.variant !== 'base';
    return rarity === 'any' || (c.rarity === rarity && c.variant === 'base');
  });
  const progress = setProgress(data, setId);
  const inSet = new Set(all.map((c) => c.id));
  const dupes = duplicates(data).filter((d) => inSet.has(d.card.id));
  const dupeCount = dupes.reduce((n, d) => n + d.extra, 0);
  const dupeValue = dupes.reduce((n, d) => n + d.extra * sellValue(d.card), 0);

  const open = openId ? all.find((c) => c.id === openId) : null;
  if (open) {
    const i = shown.findIndex((c) => c.id === open.id);
    return (
      <CardDetail card={open} count={owned[open.id] ?? 0} onBack={() => setOpenId(null)}
        prev={i > 0 ? () => setOpenId(shown[i - 1].id) : undefined}
        next={i >= 0 && i < shown.length - 1 ? () => setOpenId(shown[i + 1].id) : undefined} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          {CARD_SETS.length > 1 ? (
            <select className="input w-auto py-1 font-serif text-lg" aria-label="Card set" value={setId} onChange={(e) => setSetId(e.target.value)}>
              {CARD_SETS.map((s) => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
            </select>
          ) : <h3 className="font-serif text-lg font-semibold">{CARD_SETS[0].name} <span className="text-sm font-normal text-ink-500">{setId}</span></h3>}
          <p className="text-xs text-ink-500">{progress.owned} of {progress.total} cards · {Math.round((progress.owned / progress.total) * 100)}% complete</p>
        </div>
        {dupeCount > 0 && (
          <ConfirmButton className="btn" confirmLabel={`Sell ${dupeCount} for ${formatBerries(dupeValue)}?`}
            onConfirm={() => st.sellDuplicates(dupes.map((d) => ({ id: d.card.id, count: d.extra })))}>
            Sell all {dupeCount} duplicates · {formatBerries(dupeValue)}
          </ConfirmButton>
        )}
      </div>
      <ProgressBar value={progress.owned / progress.total} label={`${setId} completion`} />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Show" value={show} onChange={setShow}
          options={[{ value: 'all', label: 'All' }, { value: 'owned', label: 'Owned' }, { value: 'missing', label: 'Missing' }, { value: 'dupes', label: 'Duplicates' }]} />
        <select className="input w-auto py-1 text-xs" aria-label="Rarity" value={rarity} onChange={(e) => setRarity(e.target.value as RarityFilter)}>
          <option value="any">Any rarity</option>
          {(['L', 'C', 'UC', 'R', 'SR', 'SEC'] as Rarity[]).map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
          <option value="alt">Alternate arts</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="📒" title={progress.owned ? 'No cards match' : 'Your binder is empty'}
          hint={progress.owned ? 'Try another filter.' : 'Open packs from the Shop to start your collection.'} />
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
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
                  <div className="tcg-card flex flex-col items-center justify-center gap-0.5 border-2 border-dashed border-cream-300 bg-cream-100/60 text-center"
                    aria-label={`Missing: ${c.number} ${rarityText(c)}`} role="img">
                    <span className="text-[10px] text-ink-400">{c.number}</span>
                    <span className="px-1 text-[9px] leading-tight text-ink-400">{c.variant === 'base' ? c.rarity : rarityText(c).split(' · ')[1]}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CardDetail({ card, count, onBack, prev, next }: { card: Card; count: number; onBack: () => void; prev?: () => void; next?: () => void }) {
  const st = useStore.getState();
  const value = sellValue(card);
  const extra = Math.max(0, count - 1);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="text-sm text-sky-500 underline" onClick={onBack}>← Binder</button>
        <div className="flex gap-1">
          <button className="btn btn-ghost px-2" onClick={prev} disabled={!prev} aria-label="Previous card">‹</button>
          <button className="btn btn-ghost px-2" onClick={next} disabled={!next} aria-label="Next card">›</button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="w-56 shrink-0">
          <CardFace card={card} className={toneOf(card) === 'legend' ? 'tcg-hit-legend' : toneOf(card) === 'glow' ? 'tcg-hit-glow' : ''} />
        </div>
        <div className="w-full space-y-3">
          <div>
            <h3 className="font-serif text-xl font-semibold">{card.name}</h3>
            <p className="text-sm text-ink-500">{rarityText(card)} · {card.number}</p>
            <p className="text-sm text-ink-500">{card.type} · {card.color}</p>
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
          {card.price != null && <p className="text-[11px] text-ink-400">Market price ≈ ${card.price.toFixed(2)} (snapshot). Sells for {formatBerries(value)}.</p>}
        </div>
      </div>
    </div>
  );
}
