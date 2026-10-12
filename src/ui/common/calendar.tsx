import { useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { formatTime, nowLocalInput, relativeDay } from '../../domain/dates';
import type { AgendaItem } from '../../domain/services';
import { ConfirmButton, Dialog, Field } from './ui';

export const KIND_ICON: Record<AgendaItem['kind'], string> = {
  event: '●', deadline: '■', task: '☑', milestone: '◆', project: '📘', reminder: '🔔',
};
export const KIND_LABEL: Record<AgendaItem['kind'], string> = {
  event: 'Event', deadline: 'Deadline', task: 'Task due', milestone: 'Milestone', project: 'Project deadline', reminder: 'Reminder',
};

export function EventDialog({ eventId, date, onClose }: { eventId?: string; date?: string; onClose: () => void }) {
  const events = useStore((s) => s.data.events);
  const st = useStore.getState();
  const today = useToday();
  const ex = events.find((e) => e.id === eventId);
  const [f, setF] = useState({
    title: ex?.title ?? '', kind: ex?.kind ?? ('event' as 'event' | 'deadline'), date: ex?.date ?? date ?? today,
    time: ex?.time ?? '', endTime: ex?.endTime ?? '', notes: ex?.notes ?? '', remind: ex?.remindBefore == null ? '' : String(ex.remindBefore),
  });
  const [err, setErr] = useState('');
  return (
    <Dialog title={ex ? 'Edit event' : 'New event'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return setErr('Give it a title.');
        if (!f.date) return setErr('Pick a date.');
        if (f.time && f.endTime && f.endTime < f.time) return setErr('End time is before the start time.');
        const patch = { title: f.title.trim(), kind: f.kind, date: f.date, time: f.time || null, endTime: f.endTime || null, notes: f.notes, remindBefore: f.remind === '' ? null : Number(f.remind) };
        if (ex) st.updateEvent(ex.id, patch); else st.addEvent(patch);
        st.toast(ex ? 'Event saved' : 'Event added');
        onClose();
      }}>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setErr(''); }} />{err && <span role="alert" className="mt-1 block text-xs text-clay-600">{err}</span>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'event' | 'deadline' })}><option value="event">● Event</option><option value="deadline">■ Deadline</option></select></Field>
          <Field label="Date"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Start"><input type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          <Field label="End"><input type="time" className="input" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        </div>
        <Field label="Remind me">
          <select className="input" value={f.remind} onChange={(e) => setF({ ...f, remind: e.target.value })}>
            <option value="">No reminder</option><option value="0">At the time</option><option value="10">10 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option>
          </select>
          {!f.time && f.remind !== '' && <span className="mt-1 block text-xs text-ink-500">No start time set — reminders count from 09:00.</span>}
        </Field>
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="flex items-center justify-between">
          {ex ? <ConfirmButton confirmLabel="Delete event?" onConfirm={() => { st.deleteEvent(ex.id); onClose(); }}>Delete</ConfirmButton> : <span />}
          <div className="flex gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
        </div>
      </form>
    </Dialog>
  );
}

export function ReminderDialog({ onClose }: { onClose: () => void }) {
  const st = useStore.getState();
  const [title, setTitle] = useState('');
  const [at, setAt] = useState(nowLocalInput(60));
  const [err, setErr] = useState('');
  return (
    <Dialog title="New reminder" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setErr('What should we remind you about?');
        if (!at) return setErr('Pick a date and time.');
        st.addReminder(title, at); st.toast('Reminder set'); onClose();
      }}>
        <Field label="Reminder"><input className="input" value={title} onChange={(e) => { setTitle(e.target.value); setErr(''); }} />{err && <span role="alert" className="mt-1 block text-xs text-clay-600">{err}</span>}</Field>
        <Field label="When"><input type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Set reminder</button></div>
      </form>
    </Dialog>
  );
}

/** Items grouped by day. Clicking an item routes to the right editor / panel. */
export function Agenda({ items, onOpen, empty }: { items: AgendaItem[]; onOpen: (i: AgendaItem) => void; empty?: string }) {
  const today = useToday();
  if (!items.length) return <p className="rounded-lg border border-dashed border-cream-300 p-4 text-center text-sm text-ink-500">{empty ?? 'Nothing scheduled.'}</p>;
  const groups = new Map<string, AgendaItem[]>();
  items.forEach((i) => groups.set(i.date, [...(groups.get(i.date) ?? []), i]));
  return (
    <div className="space-y-3">
      {[...groups].map(([date, list]) => (
        <div key={date}>
          <h4 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${date < today ? 'text-clay-600' : 'text-ink-500'}`}>{relativeDay(date, today)}</h4>
          <ul className="space-y-1">
            {list.map((i) => (
              <li key={i.key}>
                <button onClick={() => onOpen(i)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-cream-100">
                  <span className="w-5 text-center" aria-hidden>{KIND_ICON[i.kind]}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${i.done ? 'text-ink-400 line-through' : ''}`}>{i.title}</span>
                  <span className="shrink-0 text-xs text-ink-500">{i.time ? formatTime(i.time) : KIND_LABEL[i.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
