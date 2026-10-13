import { useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { formatDay, formatTime, nowLocalInput, relativeDay } from '../../domain/dates';
import { describeSpan, describeWhen } from '../../domain/external';
import { useFeeds } from '../../state/feeds';
import type { AgendaItem } from '../../domain/services';
import { ConfirmButton, Dialog, Field } from './ui';

export const KIND_ICON: Record<AgendaItem['kind'], string> = {
  event: '●', deadline: '■', task: '☑', milestone: '◆', project: '📘', reminder: '🔔', external: '◉',
};
export const KIND_LABEL: Record<AgendaItem['kind'], string> = {
  event: 'Event', deadline: 'Deadline', task: 'Task due', milestone: 'Milestone', project: 'Project deadline', reminder: 'Reminder', external: 'Imported (read-only)',
};

/** The little marker in front of an agenda row: a kind icon, or the calendar's own colour for imported meetings. */
export function KindMark({ item }: { item: Pick<AgendaItem, 'kind' | 'color'> }) {
  if (item.kind === 'external') return <span aria-hidden className="mx-auto inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: item.color }} />;
  return <span aria-hidden>{KIND_ICON[item.kind]}</span>;
}

/** Read-only view of a meeting imported from a calendar feed. There is nothing to edit or delete here by design. */
export function ExternalEventDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const ev = useFeeds((s) => s.events.find((e) => e.id === eventId));
  const feed = useFeeds((s) => s.feeds.find((f) => f.id === ev?.feedId));
  if (!ev) return null;
  return (
    <Dialog title={ev.title} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 text-ink-500">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: feed?.color }} />
          <span>{feed?.name ?? 'Imported calendar'} · read-only</span>
        </p>
        <p className="font-medium">{describeWhen(ev, (d) => formatDay(d, true), formatTime)}</p>
        {ev.location && <p><span className="label">Where</span>{ev.location}</p>}
        {ev.description && <p className="whitespace-pre-wrap break-words text-ink-600"><span className="label">Details</span>{ev.description}</p>}
        <p className="text-xs text-ink-500">This meeting comes from your connected calendar. Change it there and it will update here within about 15 minutes.</p>
        <div className="flex justify-end"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </Dialog>
  );
}

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
  const range = (i: AgendaItem) => describeSpan(i, (d) => formatDay(d), formatTime);
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
                  <span className="w-5 text-center"><KindMark item={i} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${i.done ? 'text-ink-400 line-through' : ''}`}>{i.title}</span>
                    {range(i) && <span className="block truncate text-xs text-ink-500">{range(i)}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">{i.time ? formatTime(i.time) : i.kind === 'external' ? `All day · ${i.feedName}` : KIND_LABEL[i.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
