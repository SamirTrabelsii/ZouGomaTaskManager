import { useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { formatDay, LOCALE, parseDay } from '../../domain/dates';
import { cardById, cardSets } from '../../domain/cards';
import { EARNING_SOURCES, earningsByWeek, earningTotals, economyStart, formatBerries } from '../../domain/economy';
import { CardThumb, rarityText } from '../cards/CardArt';

const WEEKS = 12;
/** Categorical slots in fixed order (validated on the card surface: CVD ΔE ≥ 8.4, contrast ≥ 3:1). */
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

/** Berries earned per week, stacked by source, with the all-time split as the legend. */
export function BerriesBySource() {
  const ledger = useStore((s) => s.data.ledger);
  const today = useToday();
  const [hover, setHover] = useState<number | null>(null);
  if (!economyStart(ledger)) return null;
  const weeks = earningsByWeek(ledger, today, WEEKS);
  const totals = earningTotals(ledger);
  const recent = weeks.reduce((n, w) => n + w.total, 0);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const W = 20, H = 80, top = 6, base = 72;
  const y = (v: number) => (v / max) * (base - top);
  const lbl = (d: string) => parseDay(d).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  const h = hover == null ? null : weeks[hover];

  return (
    <section className="card md:col-span-2" aria-labelledby="bb">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bb" className="font-semibold">Berries by source · last {WEEKS} weeks</h2>
        <span className="text-xs text-ink-500">{formatBerries(recent)} in {WEEKS} weeks · {formatBerries(totals.total)} all time</span>
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${WEEKS * W} ${H}`} className="h-40 w-full" role="img" preserveAspectRatio="none"
          aria-label={`Berries earned per week by source, last ${WEEKS} weeks`} onMouseLeave={() => setHover(null)}>
          <line x1="0" x2={WEEKS * W} y1={top} y2={top} stroke="#2a3566" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {weeks.map((w, i) => {
            let acc = 0;
            const segs = EARNING_SOURCES.map((s, k) => ({ k, v: w.by[s.id] })).filter((s) => s.v > 0);
            return (
              <g key={w.start} opacity={hover == null || hover === i ? 1 : 0.45}>
                {segs.map((s, j) => {
                  const hgt = y(s.v);
                  const yTop = base - acc - hgt;
                  acc += hgt;
                  const last = j === segs.length - 1;
                  // 2px-ish surface gap between stacked segments; only the top of the stack is rounded
                  return <rect key={s.k} x={i * W + 4} y={yTop + (j ? 0.6 : 0)} width={W - 8} height={Math.max(0.8, hgt - (j ? 0.6 : 0))}
                    rx={last ? 2.5 : 0.4} fill={COLORS[s.k]} />;
                })}
                {!segs.length && <rect x={i * W + 4} y={base - 1} width={W - 8} height={1} fill="#2a3566" />}
                {/* hit target: the whole column */}
                <rect x={i * W} y={0} width={W} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} />
              </g>
            );
          })}
          <line x1="0" x2={WEEKS * W} y1={base + 0.5} y2={base + 0.5} stroke="#34427a" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="pointer-events-none absolute right-0 top-0 -translate-y-1/2 bg-transparent text-[10px] tabular-nums text-ink-400">{formatBerries(max)}</span>
        {h && hover != null && (
          <div role="status" className="pointer-events-none absolute top-0 z-10 w-52 rounded-lg border border-cream-300 bg-cream-50 p-2 text-xs shadow-soft"
            // beside the hovered column, never over it
            style={hover >= WEEKS / 2 ? { right: `calc(${100 - (hover / WEEKS) * 100}% + 4px)` } : { left: `calc(${((hover + 1) / WEEKS) * 100}% + 4px)` }}>
            <div className="mb-1 font-semibold">Week of {formatDay(h.start)}</div>
            {EARNING_SOURCES.map((s, k) => h.by[s.id] > 0 && (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COLORS[k] }} />{s.label}</span>
                <span className="tabular-nums">{formatBerries(h.by[s.id])}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-cream-300 pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{formatBerries(h.total)}</span></div>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400"><span>{lbl(weeks[0].start)}</span><span>{lbl(weeks[WEEKS - 1].start)}</span></div>
      {/* legend: identity never by color alone, and it doubles as the all-time table */}
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3" aria-label="All-time Berries by source">
        {EARNING_SOURCES.map((s, k) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ink-700"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[k] }} />{s.label}</span>
            <span className="tabular-nums text-ink-900">{formatBerries(totals.by[s.id])}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 text-ink-500"><span>Card sales (not counted)</span><span className="tabular-nums">{formatBerries(totals.sales)}</span></li>
      </ul>
    </section>
  );
}

/** The latest big pulls (Super Rare and up), with when and how you got them. */
export function PullHistory() {
  const pulls = useStore((s) => s.data.cards.pulls ?? []);
  const started = useStore((s) => !!economyStart(s.data.ledger));
  const [all, setAll] = useState(false);
  if (!started) return null;
  const shown = all ? pulls : pulls.slice(0, 20);
  const setOf = (id: string) => cardSets().find((x) => x.cards.some((c) => c.id === id))?.id ?? '';
  return (
    <section className="card md:col-span-2" aria-labelledby="ph">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ph" className="font-semibold">Big pulls</h2>
        <span className="text-xs text-ink-500">Super Rare and up, newest first</span>
      </div>
      {pulls.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-500">Your Super Rares, Secret Rares and alternate arts will be listed here as you pull them.</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => {
            const c = cardById(p.id);
            if (!c) return null;
            return (
              <li key={`${p.id}-${p.at}-${i}`} className="flex items-center gap-3 rounded-lg bg-cream-100/70 p-2">
                <div className="w-10 shrink-0"><CardThumb id={c.id} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-xs text-moss-400">{rarityText(c)}</div>
                  <div className="text-[11px] text-ink-500">
                    {setOf(c.id)} · {new Date(p.at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })} · {p.via === 'market' ? '🛒 bought' : '📦 pulled'}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pulls.length > shown.length && <button className="btn btn-ghost mt-2 w-full" onClick={() => setAll(true)}>Show all {pulls.length}</button>}
    </section>
  );
}
