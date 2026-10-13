import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToday } from '../state/hooks';
import { agendaItems, dailyProgress, habitCompletionToday, nextUp, sortTasks } from '../domain/services';
import { useExternalItems } from '../state/feeds';
import { addDays, formatDay, formatTime, relativeDay } from '../domain/dates';
import { Ring } from './common/ui';

/** Glanceable daily overview. Read-only summary; each row jumps to the relevant object. */
export function Overview() {
  const data = useStore((s) => s.data);
  const select = useStore((s) => s.select);
  const today = useToday();
  const [open, setOpen] = useState(false); // collapsed by default so the room stays unobstructed

  const prog = dailyProgress(data.tasks, today);
  const hab = habitCompletionToday(data.habits, data.habitLogs, today);
  const imported = useExternalItems();
  const next = nextUp(data.events, imported);
  const priorities = useMemo(
    () => sortTasks(data.tasks.filter((t) => t.status !== 'done' && (t.priority === 'high' || (t.dueDate && t.dueDate <= today))), 'priority').slice(0, 3),
    [data.tasks, today],
  );
  const deadlines = useMemo(() => {
    const horizon = addDays(today, 7);
    return agendaItems(data).filter((i) => !i.done && i.date >= today && i.date <= horizon && ['deadline', 'milestone', 'project'].includes(i.kind)).slice(0, 2);
  }, [data, today]);
  const activeProjects = data.projects.filter((p) => p.status === 'active').length;

  return (
    <section aria-label="Daily overview" className="pointer-events-auto w-[17.5rem] rounded-2xl border border-cream-300 bg-cream-50/90 shadow-soft backdrop-blur-md">
      <button className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ring value={prog.ratio} size={48}>{prog.total ? `${prog.done}/${prog.total}` : '–'}</Ring>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{formatDay(today)}</div>
          <div className="truncate text-xs text-ink-500">{prog.remaining} left today · {hab.done}/{hab.total} habits</div>
        </div>
        <span aria-hidden className="text-ink-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-cream-300 p-3 text-sm">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Priorities</h3>
            {priorities.length === 0 ? <p className="text-xs text-ink-500">Nothing pressing. 🌿</p> : (
              <ul className="space-y-0.5">{priorities.map((t) => <li key={t.id}><button className="w-full truncate text-left hover:underline" onClick={() => select('desk')}>{t.priority === 'high' ? '▲ ' : '• '}{t.title}</button></li>)}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Next event</h3>
            {next ? <button className="w-full truncate text-left hover:underline" onClick={() => select('calendar')}>{next.color ? <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: next.color }} /> : '● '}{next.title} · {relativeDay(next.date, today)}{next.time && ` ${formatTime(next.time)}`}</button> : <p className="text-xs text-ink-500">No upcoming events.</p>}
          </div>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Deadlines · 7 days</h3>
            {deadlines.length === 0 ? <p className="text-xs text-ink-500">None this week.</p> : (
              <ul className="space-y-0.5">{deadlines.map((d) => <li key={d.key} className="truncate">■ {d.title} · {relativeDay(d.date, today)}</li>)}</ul>
            )}
          </div>
          <div className="flex justify-between text-xs text-ink-500">
            <button className="hover:underline" onClick={() => select('bookshelf')}>📘 {activeProjects} active project{activeProjects === 1 ? '' : 's'}</button>
            <button className="hover:underline" onClick={() => select('plants')}>🌿 {hab.done}/{hab.total} habits</button>
          </div>
        </div>
      )}
    </section>
  );
}
