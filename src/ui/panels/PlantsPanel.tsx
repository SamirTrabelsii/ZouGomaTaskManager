import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { addDays, daysRange, formatDay, LOCALE, parseDay, startOfWeek } from '../../domain/dates';
import { cleanHabitDays, consistency, habitDoneOn, habitDueOn, habitSatisfied, plantGrowth, streaks, weekCount } from '../../domain/services';
import { TEMPLATES } from '../../domain/templates';
import type { Habit } from '../../domain/types';
import { ConfirmButton, Dialog, EmptyState, Field, ProgressBar } from '../common/ui';
import { PanelShell } from './PanelShell';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** "Every day", "Weekdays", "Weekends", "Mon, Wed, Fri" or "3× per week". */
function freq(h: Pick<Habit, 'frequency' | 'target' | 'days'>) {
  if (h.frequency === 'weekly') return `${h.target}× per week`;
  const days = cleanHabitDays(h.days);
  if (!days) return 'Every day';
  if (same(days, WEEKDAYS)) return 'Weekdays';
  if (same(days, WEEKEND)) return 'Weekends';
  return days.map((d) => DAY_SHORT[d - 1]).join(', ');
}

export function PlantsPanel() {
  const { habits, habitLogs, prefs } = useStore((s) => s.data);
  const focus = useStore((s) => s.focus);
  const st = useStore.getState();
  const today = useToday();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<null | 'new'>(null);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { if (focus?.type === 'habit') setOpen(focus.id); }, [focus]);

  if (open && habits.some((h) => h.id === open)) return <HabitDetail id={open} onBack={() => setOpen(null)} />;

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);
  const week = daysRange(today, 7);
  const enabledTemplates = TEMPLATES.filter((t) => prefs.templates[t.id]?.enabled && t.starterHabits.length);

  return (
    <PanelShell title="Habits & Routines" icon="🌿" subtitle="Each habit grows a plant in your room">
      <button className="btn btn-primary w-full" onClick={() => setForm('new')}>＋ New habit</button>
      {active.length === 0 ? (
        <EmptyState icon="🌱" title="Plant your first habit" hint="Log a habit and its plant starts to grow. Missing a day never harms it."
          action={enabledTemplates.length ? (
            <button className="btn" onClick={() => { const n = enabledTemplates.reduce((a, t) => a + st.addTemplateStarters(t.id), 0); st.toast(n ? `Added ${n} suggested habits` : 'Already added'); }}>Add suggested habits</button>
          ) : undefined} />
      ) : (
        <ul className="space-y-2">
          {active.map((h) => {
            const done = habitDoneOn(h, habitLogs, today);
            const sat = habitSatisfied(h, habitLogs, today);
            const due = habitDueOn(h, today);
            const g = plantGrowth(h, habitLogs, today);
            const s = streaks(h, habitLogs, today);
            return (
              <li key={h.id} className="card">
                <div className="flex items-start gap-3">
                  <button
                    role="checkbox" aria-checked={done} aria-label={`${done ? 'Unlog' : 'Log'} ${h.title} for today`}
                    onClick={() => st.toggleHabitLog(h.id, today)}
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm transition ${done ? 'border-moss-600 bg-moss-600 text-white' : 'border-ink-400 hover:border-moss-600'}`}
                  >{done ? '✓' : ''}</button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(h.id)} aria-label={`Open ${h.title}`}>
                    <div className="truncate font-medium">{h.title}</div>
                    <div className="text-xs text-ink-500">
                      {freq(h)} · 🌿 {g.stageName} · 🔥 {s.current} {h.frequency === 'daily' ? 'day' : 'week'} streak
                      {h.frequency === 'weekly' && ` · ${weekCount(h, habitLogs, today)}/${h.target} this week`}
                      {sat && !done && (due ? ' · ✓ week target met' : ' · 😴 rest day')}
                    </div>
                  </button>
                </div>
                <div className="mt-2 flex gap-1" role="group" aria-label={`Last 7 days for ${h.title}`}>
                  {week.map((d) => {
                    const on = habitDoneOn(h, habitLogs, d);
                    const off = !habitDueOn(h, d);
                    return (
                      <button
                        key={d} onClick={() => st.toggleHabitLog(h.id, d)} aria-pressed={on}
                        aria-label={`${formatDay(d)}: ${on ? 'logged' : off ? 'rest day' : 'not logged'}`} title={off ? `${formatDay(d)} · rest day` : formatDay(d)}
                        className={`flex h-7 flex-1 flex-col items-center justify-center rounded-md text-[10px] leading-none transition ${on ? 'bg-moss-500 text-white' : off ? 'border border-dashed border-cream-300 text-ink-400 opacity-60 hover:opacity-100' : 'bg-cream-200 text-ink-500 hover:bg-cream-300'}`}
                      >
                        <span>{parseDay(d).toLocaleDateString(LOCALE, { weekday: 'narrow' })}</span>
                        <span>{on ? '●' : off ? '–' : '○'}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <button className="text-xs text-sky-500 underline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Hide' : 'Show'} {archived.length} paused habit{archived.length > 1 ? 's' : ''}
        </button>
      )}
      {showArchived && (
        <ul className="space-y-1">
          {archived.map((h) => (
            <li key={h.id} className="flex items-center justify-between rounded-lg px-2 py-1 text-sm text-ink-500">
              {h.title}
              <button className="btn btn-ghost text-xs" onClick={() => st.updateHabit(h.id, { archived: false })}>Resume</button>
            </li>
          ))}
        </ul>
      )}
      {form && <HabitForm onClose={() => setForm(null)} />}
    </PanelShell>
  );
}

function HabitForm({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const st = useStore.getState();
  const [f, setF] = useState({
    title: habit?.title ?? '', frequency: habit?.frequency ?? ('daily' as Habit['frequency']), target: habit?.target ?? 3,
    days: cleanHabitDays(habit?.days) ?? EVERY_DAY,
  });
  const toggleDay = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort((a, b) => a - b) });
  const [err, setErr] = useState('');
  return (
    <Dialog title={habit ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return setErr('Name your habit.');
        if (f.frequency === 'daily' && f.days.length === 0) return setErr('Pick at least one day.');
        const patch = { title: f.title.trim(), frequency: f.frequency, target: Math.min(7, Math.max(1, f.target)), days: f.frequency === 'daily' ? cleanHabitDays(f.days) : null };
        if (habit) st.updateHabit(habit.id, patch); else st.addHabit(patch);
        st.toast(habit ? 'Habit saved' : 'Habit planted 🌱');
        onClose();
      }}>
        <Field label="Habit"><input className="input" value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setErr(''); }} placeholder="e.g. Read for 15 minutes" />{err && <span role="alert" className="text-xs text-clay-600">{err}</span>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Frequency">
            <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as Habit['frequency'] })}>
              <option value="daily">On set days</option><option value="weekly">X times a week</option>
            </select>
          </Field>
          {f.frequency === 'weekly' && (
            <Field label="Times per week"><input type="number" min={1} max={7} className="input" value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></Field>
          )}
        </div>
        {f.frequency === 'daily' && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-ink-500">Days</legend>
            <div className="flex gap-1" role="group" aria-label="Days the habit is due">
              {DAY_SHORT.map((label, i) => {
                const on = f.days.includes(i + 1);
                return (
                  <button key={label} type="button" aria-pressed={on} aria-label={label} onClick={() => { toggleDay(i + 1); setErr(''); }}
                    className={`h-8 flex-1 rounded-md text-xs font-medium transition ${on ? 'bg-moss-600 text-white' : 'bg-cream-200 text-ink-500 hover:bg-cream-300'}`}>{label.slice(0, 2)}</button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {([['Every day', EVERY_DAY], ['Weekdays', WEEKDAYS], ['Weekends', WEEKEND]] as const).map(([label, days]) => (
                <button key={label} type="button" className={`btn px-2 py-1 text-xs ${same(f.days, days) ? 'btn-primary' : ''}`} onClick={() => { setF({ ...f, days: [...days] }); setErr(''); }}>{label}</button>
              ))}
            </div>
          </fieldset>
        )}
        <p className="text-xs text-ink-500">
          {f.frequency === 'daily'
            ? 'Kept for the week when it is logged on each of these days. Other days are rest days: logging them is a bonus, skipping them never breaks the streak.'
            : `Kept for the week once logged ${Math.min(7, Math.max(1, f.target))} times, on any days.`}
        </p>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
    </Dialog>
  );
}

function HabitDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { habits, habitLogs } = useStore((s) => s.data);
  const st = useStore.getState();
  const today = useToday();
  const [edit, setEdit] = useState(false);
  const h = habits.find((x) => x.id === id)!;
  const g = plantGrowth(h, habitLogs, today);
  const s = streaks(h, habitLogs, today);
  const c28 = consistency(h, habitLogs, today, 28);
  // 12 weeks, Monday-first columns
  const start = addDays(startOfWeek(today), -11 * 7);
  const cells = Array.from({ length: 84 }, (_, i) => addDays(start, i));
  const total = habitLogs.filter((l) => l.habitId === id).length;
  return (
    <PanelShell title={h.title} icon="🌿" subtitle={`${freq(h)} · ${g.stageName}`} actions={<button className="btn btn-ghost px-2" onClick={() => setEdit(true)} aria-label="Edit habit">✎</button>}>
      <button className="text-sm text-sky-500 underline" onClick={onBack}>← All habits</button>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card"><div className="text-xl font-semibold">{s.current}</div><div className="text-xs text-ink-500">current streak</div></div>
        <div className="card"><div className="text-xl font-semibold">{s.best}</div><div className="text-xs text-ink-500">best streak</div></div>
        <div className="card"><div className="text-xl font-semibold">{total}</div><div className="text-xs text-ink-500">total logs</div></div>
      </div>
      <div className="card">
        <div className="mb-1 flex justify-between text-sm"><span>Consistency · last 4 weeks</span><span>{Math.round(c28 * 100)}%</span></div>
        <ProgressBar value={c28} label="Consistency" />
        <p className="mt-2 text-xs text-ink-500">Your plant only grows with completions — it never shrinks when you miss a day.</p>
      </div>
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Last 12 weeks</h3>
        <div className="grid grid-flow-col grid-rows-7 gap-1" role="group" aria-label="Habit history">
          {cells.map((d) => {
            const on = habitDoneOn(h, habitLogs, d);
            const future = d > today;
            const off = !habitDueOn(h, d);
            return (
              <button key={d} disabled={future} aria-pressed={on} aria-label={`${formatDay(d)}: ${on ? 'logged' : 'not logged'}`} title={formatDay(d)}
                onClick={() => st.toggleHabitLog(id, d)}
                className={`aspect-square rounded-[4px] text-[8px] ${future ? 'opacity-20' : ''} ${on ? 'bg-moss-500 text-white' : off ? 'border border-dashed border-cream-300' : 'bg-cream-200 hover:bg-cream-300'} ${d === today ? 'ring-2 ring-sky-500' : ''}`}>{on ? '✓' : ''}</button>
            );
          })}
        </div>
      </section>
      <div className="flex justify-between">
        <button className="btn" onClick={() => { st.updateHabit(id, { archived: true }); onBack(); }}>Pause habit</button>
        <ConfirmButton confirmLabel="Delete + logs?" onConfirm={() => { st.deleteHabit(id); onBack(); }}>Delete</ConfirmButton>
      </div>
      {edit && <HabitForm habit={h} onClose={() => setEdit(false)} />}
    </PanelShell>
  );
}
