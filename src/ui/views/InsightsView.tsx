import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { addDays, formatDay, LOCALE, startOfWeek, parseDay } from '../../domain/dates';
import { completedByDay, consistency, goalProgress, habitRatioByDay, plantGrowth, pointsByDay, projectProgress, streaks, sumPoints, weeklySummary } from '../../domain/services';
import { EmptyState, ProgressBar } from '../common/ui';
import { ScopeBadge } from '../common/icons';

function Bars({ values, labels, label, max }: { values: number[]; labels: string[]; label: string; max?: number }) {
  const m = Math.max(max ?? 0, ...values, 1);
  return (
    <figure>
      <svg viewBox={`0 0 ${values.length * 20} 80`} className="h-28 w-full" role="img" aria-label={label} preserveAspectRatio="none">
        {values.map((v, i) => (
          <g key={i}>
            <rect x={i * 20 + 3} y={70 - (v / m) * 62} width={14} height={Math.max(1.5, (v / m) * 62)} rx={3} fill={v > 0 ? '#eba14a' : '#2a3566'}><title>{`${labels[i]}: ${v}`}</title></rect>
          </g>
        ))}
        <line x1="0" x2={values.length * 20} y1="71" y2="71" stroke="#34427a" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[10px] text-ink-400"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></figcaption>
    </figure>
  );
}

export function InsightsView() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const days = 14;
  const done = completedByDay(data.tasks, today, days);
  const hab = habitRatioByDay(data.habits, data.habitLogs, today, days);
  const total14 = done.reduce((a, d) => a + d.count, 0);
  const pts = pointsByDay(data.tasks, today, days);
  const pts14 = pts.reduce((a, d) => a + d.points, 0);
  const ws = startOfWeek(today);
  const thisWeek = weeklySummary(data, ws);
  const lastWeek = weeklySummary(data, addDays(ws, -7));
  const habits = data.habits.filter((h) => !h.archived);
  const lbl = (d: string) => parseDay(d).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
  const empty = !data.tasks.length && !data.habits.length && !data.projects.length && !data.goals.length;

  const delta = (a: number, b: number) => (a === b ? 'same as last week' : a > b ? `${a - b} more than last week` : `${b - a} fewer than last week`);

  return (
    <div className="scroll-thin mx-auto h-full max-w-6xl overflow-y-auto px-4 pb-24 pt-20 md:pb-8">
      <h1 className="mb-1 font-serif text-2xl font-semibold">Insights</h1>
      <p className="mb-4 text-sm text-ink-500">A calm look at how things are going — patterns, not scores.</p>
      {empty && <EmptyState icon="📈" title="Insights will appear as you use LifeOS" hint="Complete a few tasks or log a habit and trends show up here." />}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card" aria-labelledby="wk">
          <h2 id="wk" className="mb-2 font-semibold">This week · {formatDay(ws)} – {formatDay(addDays(ws, 6))}</h2>
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            {[['Tasks done', thisWeek.tasksCompleted], ['Story points', thisWeek.pointsCompleted],['Habit check-ins', thisWeek.habitLogs], ['Milestones', thisWeek.milestonesDone], ['Notes written', thisWeek.notesWritten]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-cream-100 p-2"><dd className="text-2xl font-semibold">{v}</dd><dt className="text-[11px] text-ink-500">{k}</dt></div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-ink-700">
            {thisWeek.tasksCompleted} task{thisWeek.tasksCompleted === 1 ? '' : 's'} finished ({delta(thisWeek.tasksCompleted, lastWeek.tasksCompleted)}), {thisWeek.tasksOpen} still open.
          </p>
        </section>

        <section className="card" aria-labelledby="tc">
          <h2 id="tc" className="font-semibold">Tasks completed · last {days} days</h2>
          <p className="mb-1 text-xs text-ink-500">{total14} completed in total</p>
          <Bars values={done.map((d) => d.count)} labels={done.map((d) => lbl(d.day))} label="Tasks completed per day" />
        </section>

        <section className="card" aria-labelledby="sp">
          <h2 id="sp" className="font-semibold">Story points · last {days} days</h2>
          <p className="mb-1 text-xs text-ink-500">{pts14} points collected{total14 ? ` across ${total14} tasks` : ''} – tasks without a size count 0</p>
          <Bars values={pts.map((d) => d.points)} labels={pts.map((d) => lbl(d.day))} label="Story points collected per day" />
        </section>

        {data.scopes.length > 0 && (
          <section className="card" aria-labelledby="sc">
            <h2 id="sc" className="mb-2 font-semibold">Scopes</h2>
            <ul className="space-y-3">
              {data.scopes.map((s) => {
                const ts = data.tasks.filter((t) => t.scopeId === s.id);
                const doneTs = ts.filter((t) => t.status === 'done');
                const total = sumPoints(ts), got = sumPoints(doneTs);
                return (
                  <li key={s.id}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><ScopeBadge scope={s} /><span className="truncate">{s.title}</span></span>
                      <span className="shrink-0 text-xs text-ink-500">{doneTs.length}/{ts.length} tasks · {got}/{total} pts</span>
                    </div>
                    <ProgressBar className="mt-1" value={total ? got / total : ts.length ? doneTs.length / ts.length : 0} label={`${s.title} progress`} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="card" aria-labelledby="hc">
          <h2 id="hc" className="font-semibold">Daily habit completion · last {days} days</h2>
          <p className="mb-1 text-xs text-ink-500">Share of daily habits logged each day</p>
          {data.habits.some((h) => h.frequency === 'daily') ? (
            <Bars values={hab.map((d) => Math.round(d.ratio * 100))} max={100} labels={hab.map((d) => lbl(d.day))} label="Habit completion percentage per day" />
          ) : <p className="py-6 text-center text-sm text-ink-500">Add a daily habit to see consistency over time.</p>}
        </section>

        <section className="card" aria-labelledby="hs">
          <h2 id="hs" className="mb-2 font-semibold">Habits</h2>
          {habits.length === 0 ? <p className="text-sm text-ink-500">No habits yet.</p> : (
            <ul className="space-y-3">
              {habits.map((h) => {
                const c = consistency(h, data.habitLogs, today); const s = streaks(h, data.habitLogs, today); const g = plantGrowth(h, data.habitLogs, today);
                return (
                  <li key={h.id}>
                    <div className="flex justify-between text-sm"><span className="truncate">{h.title}</span><span className="text-ink-500">{Math.round(c * 100)}% · 🔥{s.current} (best {s.best}) · {g.stageName}</span></div>
                    <ProgressBar value={c} label={`${h.title} consistency`} className="mt-1" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="pj">
          <h2 id="pj" className="mb-2 font-semibold">Projects</h2>
          {data.projects.length === 0 ? <p className="text-sm text-ink-500">No projects yet.</p> : (
            <ul className="space-y-3">
              {data.projects.map((p) => {
                const pr = projectProgress(p, data.tasks, data.milestones);
                return (
                  <li key={p.id}>
                    <div className="flex justify-between text-sm"><span className="truncate">{p.title}</span><span className="text-ink-500">{pr.done}/{pr.total} · {Math.round(pr.ratio * 100)}% · {p.status}</span></div>
                    <ProgressBar value={pr.ratio} label={`${p.title} progress`} className="mt-1" />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="gl">
          <h2 id="gl" className="mb-2 font-semibold">Goals</h2>
          {data.goals.length === 0 ? <p className="text-sm text-ink-500">No goals yet.</p> : (
            <ul className="space-y-3">
              {data.goals.map((g) => (
                <li key={g.id}>
                  <div className="flex justify-between text-sm"><span className="truncate">{g.title}</span><span className="text-ink-500">{g.current}/{g.target} {g.unit} · {Math.round(goalProgress(g) * 100)}%</span></div>
                  <ProgressBar value={goalProgress(g)} label={`${g.title} progress`} className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

