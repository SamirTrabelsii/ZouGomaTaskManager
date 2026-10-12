import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { formatDay, monthGrid, parseDay, toDay } from '../../domain/dates';
import { agendaItems } from '../../domain/services';
import { Agenda, EventDialog, KIND_ICON, KIND_LABEL, ReminderDialog } from '../common/calendar';
import { useAgendaOpener } from '../panels/CalendarPanel';

export function CalendarView() {
  const data = useStore((s) => s.data);
  const today = useToday();
  const [cursor, setCursor] = useState(() => { const d = parseDay(today); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [sel, setSel] = useState(today);
  const [dlg, setDlg] = useState<null | 'event' | 'reminder'>(null);
  const opener = useAgendaOpener();
  const items = useMemo(() => agendaItems(data), [data]);
  const byDay = useMemo(() => {
    const m = new Map<string, typeof items>();
    items.forEach((i) => m.set(i.date, [...(m.get(i.date) ?? []), i]));
    return m;
  }, [items]);
  const grid = monthGrid(cursor.y, cursor.m);
  const shift = (n: number) => setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const title = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="mx-auto grid h-full max-w-6xl gap-4 px-4 pb-20 pt-20 md:pb-6 lg:grid-cols-[1fr_20rem]">
      <section aria-label="Month calendar" className="flex min-h-0 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-serif text-2xl font-semibold">{title}</h1>
          <div className="flex gap-1">
            <button className="btn" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
            <button className="btn" onClick={() => { const d = parseDay(today); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSel(today); }}>Today</button>
            <button className="btn" aria-label="Next month" onClick={() => shift(1)}>›</button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-cream-300 bg-cream-300" role="grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className="bg-cream-200 py-1 text-center text-xs font-medium text-ink-500">{d}</div>)}
          {grid.map((d) => {
            const inMonth = parseDay(d).getMonth() === cursor.m;
            const list = byDay.get(d) ?? [];
            return (
              <button
                key={d} role="gridcell" aria-selected={sel === d} aria-label={`${formatDay(d, true)}, ${list.length} item${list.length === 1 ? '' : 's'}`}
                onClick={() => setSel(d)} onDoubleClick={() => { setSel(d); setDlg('event'); }}
                className={`flex min-h-[3.6rem] flex-col items-stretch gap-0.5 p-1 text-left transition md:min-h-[5.2rem] ${inMonth ? 'bg-cream-50' : 'bg-cream-100 text-ink-400'} ${sel === d ? 'outline outline-2 -outline-offset-2 outline-moss-600' : 'hover:bg-cream-200'}`}
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${d === today ? 'bg-clay-500 font-bold text-white' : ''}`}>{parseDay(d).getDate()}</span>
                <span className="hidden flex-col gap-0.5 md:flex">
                  {list.slice(0, 3).map((i) => (
                    <span key={i.key} className={`truncate rounded bg-cream-200 px-1 text-[10px] ${i.done ? 'line-through opacity-60' : ''}`}><span aria-hidden>{KIND_ICON[i.kind]}</span> {i.title}</span>
                  ))}
                  {list.length > 3 && <span className="text-[10px] text-ink-500">+{list.length - 3} more</span>}
                </span>
                {list.length > 0 && <span className="text-[10px] text-ink-500 md:hidden">{'•'.repeat(Math.min(3, list.length))}</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {Object.entries(KIND_LABEL).map(([k, l]) => `${KIND_ICON[k as keyof typeof KIND_ICON]} ${l}`).join('  ·  ')}
        </p>
      </section>
      <aside className="scroll-thin min-h-0 overflow-y-auto rounded-xl border border-cream-300 bg-cream-50/70 p-3" aria-label="Selected day">
        <h2 className="font-serif text-lg font-semibold">{formatDay(sel, true)}</h2>
        <div className="my-2 grid grid-cols-2 gap-2">
          <button className="btn btn-primary" onClick={() => setDlg('event')}>＋ Event</button>
          <button className="btn" onClick={() => setDlg('reminder')}>＋ Reminder</button>
        </div>
        <Agenda items={byDay.get(sel) ?? []} onOpen={opener.open} empty="Nothing on this day." />
      </aside>
      {dlg === 'event' && <EventDialog date={sel || toDay(new Date())} onClose={() => setDlg(null)} />}
      {dlg === 'reminder' && <ReminderDialog onClose={() => setDlg(null)} />}
      {opener.node}
    </div>
  );
}

