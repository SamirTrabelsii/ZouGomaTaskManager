import { useMemo } from 'react';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { formatDay } from '../domain/dates';
import {
  balance, BERRIES_PER_POINT, currentWeek, economyStart, formatBerries, GOAL_TIER_IDS, GOAL_TIERS, lifetimeEarned,
  MAX_MULTIPLIER, MILESTONE_REWARD, OVERACHIEVER_BONUS, OVERACHIEVER_MIN, pendingBounties, PROJECT_BASE, PROJECT_MIN_POINTS,
  PROJECT_PER_POINT, STREAK_STEP, WEEKLY_MIN, WELCOME_GIFT,
} from '../domain/economy';
import { Dialog, ProgressBar, Segmented } from './common/ui';
import { ShopTab } from './cards/Shop';
import { BinderTab } from './cards/Binder';

/** Header button showing the Berries balance; a dot means a finished week's bounty is waiting. */
export function WalletChip() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const toggle = useStore((s) => s.toggleTreasury);
  const started = !!economyStart(data.ledger);
  const pending = useMemo(() => pendingBounties(data, today).length, [data, today]);
  return (
    <button className="btn btn-ghost relative px-2.5" onClick={() => toggle(true)}
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
  // steps aside while a pack is revealed, then comes back on the same tab
  const revealing = useStore((s) => !!s.packReveal);
  if (!open || revealing) return null;
  return <TreasuryDialog />;
}

function TreasuryDialog() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const st = useStore.getState();
  const close = () => st.toggleTreasury(false);
  const started = !!economyStart(data.ledger);
  const pending = useMemo(() => pendingBounties(data, today), [data, today]);
  const week = useMemo(() => currentWeek(data, today), [data, today]);
  const tab = useStore((s) => s.treasuryTab);
  const setTab = st.setTreasuryTab;

  if (!started) {
    return (
      <Dialog title="Treasury" onClose={close}>
        <div className="space-y-4">
          <p className="text-sm">Turn finished work into <b>Berries (฿)</b>, then spend them on One Piece card packs.</p>
          <Rules />
          <p className="text-xs text-ink-500">Counting starts with this week. Earlier weeks don't pay.</p>
          <button className="btn btn-primary w-full" onClick={() => st.openTreasury()}>Open my treasury · {formatBerries(WELCOME_GIFT)} welcome gift</button>
        </div>
      </Dialog>
    );
  }

  const pendingTotal = pending.reduce((n, b) => n + b.total, 0);
  const goal = week.qualified ? OVERACHIEVER_MIN : WEEKLY_MIN;
  // the ledger is append-only, so newest last
  const history = [...data.ledger].reverse().slice(0, 12);

  return (
    <Dialog title="Treasury" onClose={close} wide={tab === 'binder'}>
      <Segmented label="Treasury section" value={tab} onChange={setTab}
        options={[
          { value: 'wallet', label: '🪙 Wallet' },
          { value: 'shop', label: `🃏 Shop${data.cards.sealed.length ? ` (${data.cards.sealed.length})` : ''}` },
          { value: 'binder', label: '📒 Binder' },
        ]} />
      <div className="mt-4">{tab === 'shop' ? <ShopTab /> : tab === 'binder' ? <BinderTab /> : (
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="label">Balance</div>
            <div className="font-serif text-3xl font-semibold tabular-nums">{formatBerries(balance(data.ledger))}</div>
          </div>
          <div className="text-right text-xs text-ink-500">Lifetime earned<br /><span className="tabular-nums">{formatBerries(lifetimeEarned(data.ledger))}</span></div>
        </div>

        {pending.length > 0 && (
          <section aria-label="Bounty ready" className="card border-moss-500/50">
            <div className="mb-2 font-semibold">💰 {pending.length === 1 ? 'A week is over!' : `${pending.length} weeks are over!`}</div>
            <ul className="mb-2 space-y-0.5 text-sm">
              {pending.map((b) => (
                <li key={b.start} className="flex justify-between gap-2">
                  <span>{formatDay(b.start)} · {b.points} pts{b.qualified && b.multiplier > 1 ? ` · ×${b.multiplier}` : ''}{b.bonus ? ' · bonus' : ''}</span>
                  <span className="tabular-nums">{b.qualified ? formatBerries(b.total) : `below ${WEEKLY_MIN}`}</span>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary w-full" onClick={() => st.collectBounties()}>
              {pendingTotal ? `Collect ${formatBerries(pendingTotal)}` : 'Close the week'}
            </button>
          </section>
        )}

        <section aria-label="This week">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="label mb-0">This week</h3>
            <span className="text-xs text-ink-500">
              {week.qualified
                ? week.streak > 1 && `🔥 ${week.streak}-week streak · ×${week.multiplier}`
                : week.streakBefore > 0 && `🔥 ${week.streakBefore}-week streak · keep it alive`}
            </span>
          </div>
          <ProgressBar value={week.points / goal} label={`${week.points} of ${goal} points this week`} />
          <p className="mt-1 text-sm">
            <b className="tabular-nums">{week.points}</b> pts ·{' '}
            {week.qualified
              ? <>bounty unlocked: <b>{formatBerries(week.total)}</b>{week.points < OVERACHIEVER_MIN ? ` · ${OVERACHIEVER_MIN - week.points} more for the bonus` : ' incl. bonus'}</>
              : <>{week.toMinimum} more to unlock the bounty</>}
          </p>
        </section>

        <details>
          <summary className="cursor-pointer text-sm font-medium">How Berries work</summary>
          <div className="mt-2"><Rules /></div>
        </details>

        <section aria-label="History">
          <h3 className="label">History</h3>
          <ul className="space-y-0.5 text-sm">
            {history.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span className="truncate">{e.week ? `${formatDay(e.week.start)} · ` : ''}{e.label}</span>
                <span className={`shrink-0 tabular-nums ${e.amount > 0 ? 'text-moss-700' : 'text-ink-500'}`}>{e.amount > 0 ? '+' : ''}{formatBerries(e.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      )}</div>
    </Dialog>
  );
}
