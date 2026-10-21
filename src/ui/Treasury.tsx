import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, type TreasuryTab } from '../state/store';
import { useToday } from '../state/hooks';
import { formatDay, LOCALE } from '../domain/dates';
import type { LedgerEntry } from '../domain/types';
import {
  balance, BERRIES_PER_POINT, currentWeek, economyStart, formatBerries, GOAL_TIER_IDS, GOAL_TIERS, lifetimeEarned,
  MAX_MULTIPLIER, MILESTONE_REWARD, OVERACHIEVER_BONUS, OVERACHIEVER_MIN, pendingBounties, PROJECT_BASE, PROJECT_MIN_POINTS,
  PROJECT_PER_POINT, STREAK_STEP, WEEKLY_MIN, WELCOME_GIFT,
} from '../domain/economy';
import { Dialog, Segmented } from './common/ui';
import { ShopPage } from './cards/Shop';
import { BinderPage } from './cards/Binder';

/** Header button showing the Berries balance; a dot means a finished week's bounty is waiting. */
export function WalletChip() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const started = !!economyStart(data.ledger);
  const pending = useMemo(() => pendingBounties(data, today).length, [data, today]);
  const open = () => { const st = useStore.getState(); st.setTreasuryTab('wallet'); st.toggleTreasury(true); };
  return (
    <button className="btn btn-ghost relative px-2.5" onClick={open}
      aria-label={`Treasury${started ? `, balance ${formatBerries(balance(data.ledger))}` : ''}${pending ? ', bounty ready to collect' : ''}`}>
      <span aria-hidden>🪙</span>
      {started && <span className="hidden text-sm font-semibold tabular-nums sm:inline">{formatBerries(balance(data.ledger))}</span>}
      {pending > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-clay-500" />}
    </button>
  );
}

function Rules() {
  return (
    <ul className="space-y-1 text-sm text-ink-700">
      <li>⚓ Finish <b>{WEEKLY_MIN}+ story points</b> in a week (Mon–Sun) to earn <b>{BERRIES_PER_POINT} ฿ per point</b>. Below {WEEKLY_MIN}, the week pays nothing.</li>
      <li>🔥 Every week in a row at {WEEKLY_MIN}+ adds <b>×{STREAK_STEP}</b> to the multiplier (up to ×{MAX_MULTIPLIER}). Missing a week resets it.</li>
      <li>🏆 {OVERACHIEVER_MIN}+ points in a week adds a <b>{formatBerries(OVERACHIEVER_BONUS)}</b> bonus.</li>
      <li>📘 A finished project pays <b>{formatBerries(PROJECT_BASE)} + {PROJECT_PER_POINT} ฿ per point</b> of its finished tasks (needs {PROJECT_MIN_POINTS}+ pts). A milestone with finished work pays <b>{formatBerries(MILESTONE_REWARD)}</b>.</li>
      <li>🏺 A reached goal pays its tier, picked when you create it: {GOAL_TIER_IDS.map((t) => `${GOAL_TIERS[t].label} ${formatBerries(GOAL_TIERS[t].amount)}`).join(' · ')}. Bigger tiers pay in full only after {GOAL_TIER_IDS.filter((t) => GOAL_TIERS[t].minDays).map((t) => `${GOAL_TIERS[t].minDays}`).join(' / ')} days.</li>
      <li>📦 Collect each bounty once the week is over, then spend Berries on One Piece card packs in the Shop.</li>
    </ul>
  );
}

export function Treasury() {
  const open = useStore((s) => s.treasuryOpen);
  const started = useStore((s) => !!economyStart(s.data.ledger));
  // steps aside while a pack is revealed, then comes back where it was
  const revealing = useStore((s) => !!s.packReveal);
  if (!open || revealing) return null;
  return started ? <TreasuryPage /> : <Welcome />;
}

function Welcome() {
  const st = useStore.getState();
  return (
    <Dialog title="Treasury" onClose={() => st.toggleTreasury(false)}>
      <div className="space-y-4">
        <p className="text-sm">Turn finished work into <b>Berries (฿)</b>, then spend them on One Piece card packs.</p>
        <Rules />
        <p className="text-xs text-ink-500">Counting starts with this week. Earlier weeks don't pay.</p>
        <button className="btn btn-primary w-full" onClick={() => st.openTreasury()}>Open my treasury · {formatBerries(WELCOME_GIFT)} welcome gift</button>
      </div>
    </Dialog>
  );
}

const TABS: { id: TreasuryTab; label: string; icon: string }[] = [
  { id: 'shop', label: 'Shop', icon: '🃏' },
  { id: 'binder', label: 'Binder', icon: '📒' },
  { id: 'wallet', label: 'Wallet', icon: '🪙' },
];

/** The Treasury as a full page over the room: Shop, Binder and Wallet, with the balance always in sight. */
function TreasuryPage() {
  const data = useStore((s) => s.data);
  const tab = useStore((s) => s.treasuryTab);
  const today = useToday();
  const st = useStore.getState();
  const close = () => st.toggleTreasury(false);
  const money = balance(data.ledger);
  const sealed = data.cards.sealed.length;
  const pending = useMemo(() => pendingBounties(data, today).length, [data, today]);
  const page = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shopSet = useStore((s) => s.shopSetId);
  const binderSet = useStore((s) => s.binderSetId);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    page.current?.focus();
    // inner layers (a card, a confirm) handle Esc first and stop it, so this only fires for the page itself
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a new tab or set page starts at the top
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); }, [tab, shopSet, binderSet]);

  const go = (t: TreasuryTab) => { if (t === 'shop' && tab === 'shop') st.showShopSet(null); else st.setTreasuryTab(t); };
  const badge = (t: TreasuryTab) => (t === 'wallet' && pending ? '•' : t === 'shop' && sealed ? String(sealed) : '');

  return (
    <div ref={page} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Treasury"
      className="fixed inset-0 z-50 flex flex-col bg-cream-100 bg-[radial-gradient(ellipse_at_50%_-10%,#1d2a63,transparent_60%)] outline-none">
      <header className="flex items-center gap-2 border-b border-cream-300 bg-cream-50/90 px-3 py-2 backdrop-blur-md">
        <button className="btn btn-ghost px-2" onClick={close} aria-label="Back to the room">← <span className="hidden sm:inline">Room</span></button>
        <h1 className="font-serif text-lg font-semibold">Treasury</h1>
        <nav aria-label="Treasury" className="mx-auto hidden rounded-xl bg-cream-200/60 p-1 md:flex">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}
              className={`relative flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === t.id ? 'bg-moss-600 text-white' : 'hover:bg-cream-200'}`}>
              <span aria-hidden>{t.icon}</span>{t.label}
              {badge(t.id) && <span className={`rounded-full px-1.5 text-[10px] font-bold ${tab === t.id ? 'bg-white/25' : 'bg-clay-500 text-white'}`}>{badge(t.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {sealed > 0 && (
            <button className="btn hidden sm:inline-flex" onClick={() => st.showShopSet(null)}>📦 {sealed} to open</button>
          )}
          <button onClick={() => go('wallet')} aria-label={`Balance ${formatBerries(money)}, open the wallet`}
            className="rounded-full border border-moss-500/50 bg-moss-600/15 px-3 py-1 font-serif text-base font-semibold tabular-nums text-moss-400 transition hover:bg-moss-600/25">
            {formatBerries(money)}
          </button>
        </div>
      </header>

      <div ref={scroller} className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 md:pb-10">
          {tab === 'shop' ? <ShopPage /> : tab === 'binder' ? <BinderPage /> : <Wallet />}
        </div>
      </div>

      <nav aria-label="Treasury (mobile)" className="absolute inset-x-0 bottom-0 flex border-t border-cream-300 bg-cream-50/95 backdrop-blur-md md:hidden">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}
            className={`relative flex h-14 flex-1 flex-col items-center justify-center text-[11px] ${tab === t.id ? 'font-semibold text-moss-400' : 'text-ink-500'}`}>
            <span aria-hidden className="text-lg">{t.icon}</span>{t.label}
            {badge(t.id) && <span className="absolute right-[calc(50%-1.4rem)] top-1.5 rounded-full bg-clay-500 px-1.5 text-[10px] font-bold text-white">{badge(t.id)}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ───────── Wallet ───────── */

const KIND_ICON: Record<LedgerEntry['kind'], string> = {
  welcome: '🎁', weekly: '⚓', project: '📘', milestone: '🚩', goal: '🏺', purchase: '🃏', sale: '💱',
};
type HistoryFilter = 'all' | 'in' | 'out';

function Wallet() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const st = useStore.getState();
  const pending = useMemo(() => pendingBounties(data, today), [data, today]);
  const week = useMemo(() => currentWeek(data, today), [data, today]);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [all, setAll] = useState(false);
  const money = balance(data.ledger);
  const earned = lifetimeEarned(data.ledger);
  const spent = -data.ledger.filter((e) => e.amount < 0).reduce((n, e) => n + e.amount, 0);
  const pendingTotal = pending.reduce((n, b) => n + b.total, 0);
  // the ledger is append-only, so newest last
  const history = [...data.ledger].reverse().filter((e) => filter === 'all' || (filter === 'in' ? e.amount > 0 : e.amount < 0));
  const shown = all ? history : history.slice(0, 10);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section aria-label="Balance" className="rounded-3xl border border-cream-300 bg-[radial-gradient(ellipse_at_10%_0%,rgba(235,161,74,.25),transparent_60%)] p-5">
          <div className="label">Balance</div>
          <div className="font-serif text-5xl font-semibold tabular-nums text-moss-400">{formatBerries(money)}</div>
          <div className="mt-2 flex gap-4 text-xs text-ink-500">
            <span>Earned <b className="tabular-nums text-ink-700">{formatBerries(earned)}</b></span>
            <span>Spent <b className="tabular-nums text-ink-700">{formatBerries(spent)}</b></span>
          </div>
          <button className="btn btn-primary mt-4" onClick={() => st.showShopSet(null)}>🃏 Spend in the Shop</button>
        </section>

        {pending.length > 0 && (
          <section aria-label="Bounty ready" className="rounded-2xl border border-moss-500/60 bg-moss-600/10 p-4 shadow-[0_0_30px_-10px_rgba(255,160,70,.7)]">
            <div className="mb-2 font-serif text-lg font-semibold">💰 {pending.length === 1 ? 'A week is over!' : `${pending.length} weeks are over!`}</div>
            <ul className="mb-3 space-y-1 text-sm">
              {pending.map((b) => (
                <li key={b.start} className="flex justify-between gap-2">
                  <span>{formatDay(b.start)} · {b.points} pts{b.qualified && b.multiplier > 1 ? ` · ×${b.multiplier}` : ''}{b.bonus ? ' · bonus' : ''}</span>
                  <span className="tabular-nums">{b.qualified ? formatBerries(b.total) : `below ${WEEKLY_MIN}`}</span>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary w-full py-2 text-base" onClick={() => st.collectBounties()}>
              {pendingTotal ? `Collect ${formatBerries(pendingTotal)}` : 'Close the week'}
            </button>
          </section>
        )}

        <ThisWeek week={week} />
        <WaysToEarn />
      </div>

      <section aria-label="History" className="self-start rounded-2xl border border-cream-300 bg-cream-200/30 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-lg font-semibold">History</h2>
          <Segmented label="Show" value={filter} onChange={(f) => { setFilter(f); setAll(false); }}
            options={[{ value: 'all', label: 'All' }, { value: 'in', label: 'Earned' }, { value: 'out', label: 'Spent' }]} />
        </div>
        {shown.length === 0 ? <p className="text-sm text-ink-500">Nothing here yet.</p> : (
          <ul className="divide-y divide-cream-300/60">
            {shown.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream-200 text-base">{KIND_ICON[e.kind]}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{e.label}</div>
                  <div className="text-[11px] text-ink-500">{e.week ? `Week of ${formatDay(e.week.start)}` : new Date(e.at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
                <span className={`shrink-0 font-semibold tabular-nums ${e.amount > 0 ? 'text-moss-400' : 'text-ink-500'}`}>{e.amount > 0 ? '+' : ''}{formatBerries(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {history.length > shown.length && (
          <button className="btn btn-ghost mt-2 w-full" onClick={() => setAll(true)}>Show all {history.length}</button>
        )}
      </section>
    </div>
  );
}

/** This week's points on a track with the two thresholds (bounty, bonus) marked. */
function ThisWeek({ week }: { week: ReturnType<typeof currentWeek> }) {
  const max = OVERACHIEVER_MIN * 1.15;
  const at = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  return (
    <section aria-label="This week" className="rounded-2xl border border-cream-300 bg-cream-200/30 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-semibold">This week</h2>
        <span className="text-xs text-ink-500">
          {week.qualified
            ? week.streak > 1 ? `🔥 ${week.streak}-week streak · ×${week.multiplier}` : ''
            : week.streakBefore > 0 ? `🔥 ${week.streakBefore}-week streak · keep it alive` : ''}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-serif text-3xl font-semibold tabular-nums">{week.points}</span>
        <span className="text-sm text-ink-500">story points</span>
        <span className="ml-auto font-semibold tabular-nums text-moss-400">{week.qualified ? formatBerries(week.total) : ''}</span>
      </div>
      <div className="relative mb-5 mt-3">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={OVERACHIEVER_MIN} aria-valuenow={Math.min(week.points, OVERACHIEVER_MIN)}
          aria-label={`${week.points} points this week; ${WEEKLY_MIN} unlock the bounty, ${OVERACHIEVER_MIN} add the bonus`}
          className="h-3 overflow-hidden rounded-full bg-cream-200">
          <div className={`h-full rounded-full transition-all duration-500 ${week.qualified ? 'bg-moss-500' : 'bg-sky-500'}`} style={{ width: at(week.points) }} />
        </div>
        {[{ n: WEEKLY_MIN, label: `${WEEKLY_MIN} · bounty` }, { n: OVERACHIEVER_MIN, label: `${OVERACHIEVER_MIN} · +${formatBerries(OVERACHIEVER_BONUS)}` }].map((m) => (
          <div key={m.n} className="absolute top-0 h-3 border-l-2 border-cream-50" style={{ left: at(m.n) }} aria-hidden>
            <span className={`absolute left-0 top-4 -translate-x-1/2 whitespace-nowrap text-[10px] ${week.points >= m.n ? 'text-moss-400' : 'text-ink-500'}`}>{week.points >= m.n ? '✓ ' : ''}{m.label}</span>
          </div>
        ))}
      </div>
      <p className="text-sm">
        {week.qualified
          ? week.points < OVERACHIEVER_MIN
            ? <>Bounty unlocked. <b>{OVERACHIEVER_MIN - week.points} more</b> for the {formatBerries(OVERACHIEVER_BONUS)} bonus.</>
            : <>Bounty and bonus unlocked. Every extra point still pays.</>
          : <><b>{week.toMinimum} more points</b> to unlock this week's bounty.</>}
        <span className="text-ink-500"> Collect it once the week is over.</span>
      </p>
    </section>
  );
}

function WaysToEarn() {
  const tiles = [
    { icon: '⚓', title: 'Weekly bounty', text: `${BERRIES_PER_POINT} ฿ per point from ${WEEKLY_MIN} pts, streaks up to ×${MAX_MULTIPLIER}` },
    { icon: '📘', title: 'Finished project', text: `${formatBerries(PROJECT_BASE)} + ${PROJECT_PER_POINT} ฿ per point` },
    { icon: '🚩', title: 'Milestone', text: `${formatBerries(MILESTONE_REWARD)} each` },
    { icon: '🏺', title: 'Reached goal', text: `${formatBerries(GOAL_TIERS[GOAL_TIER_IDS[0]].amount)} to ${formatBerries(GOAL_TIERS[GOAL_TIER_IDS[GOAL_TIER_IDS.length - 1]].amount)} by tier` },
  ];
  return (
    <section aria-label="Ways to earn">
      <h2 className="label">Ways to earn</h2>
      <ul className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <li key={t.title} className="rounded-xl border border-cream-300 bg-cream-200/30 p-3">
            <div className="text-lg" aria-hidden>{t.icon}</div>
            <div className="text-sm font-semibold">{t.title}</div>
            <div className="text-xs text-ink-500">{t.text}</div>
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium">All the rules</summary>
        <div className="mt-2"><Rules /></div>
      </details>
    </section>
  );
}
