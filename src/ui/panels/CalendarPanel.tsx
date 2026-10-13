import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { addDays } from '../../domain/dates';
import type { AgendaItem } from '../../domain/services';
import { useAgenda } from '../../state/feeds';
import { Agenda, EventDialog, ExternalEventDialog, ReminderDialog } from '../common/calendar';
import { useTaskDialog } from '../common/tasks';
import { PanelShell, Section } from './PanelShell';

/** Opens the right editor / panel for any agenda entry. */
export function useAgendaOpener() {
  const taskDlg = useTaskDialog();
  const [eventId, setEventId] = useState<string | null>(null);
  const [externalId, setExternalId] = useState<string | null>(null);
  const open = (i: AgendaItem) => {
    const st = useStore.getState();
    if (i.kind === 'external') return setExternalId(i.refId);
    if (i.kind === 'event' || i.kind === 'deadline') setEventId(i.refId);
    else if (i.kind === 'task') taskDlg.open(i.refId);
    else if (i.kind === 'milestone') {
      const m = st.data.milestones.find((x) => x.id === i.refId);
      if (m) { st.select('bookshelf'); st.setFocus({ type: 'project', id: m.projectId }); }
    } else if (i.kind === 'project') { st.select('bookshelf'); st.setFocus({ type: 'project', id: i.refId }); }
    else if (i.kind === 'reminder') st.toast('Manage reminders in the Reminders list below the calendar.', 'info');
  };
  const node = <>{taskDlg.node}{eventId && <EventDialog eventId={eventId} onClose={() => setEventId(null)} />}{externalId && <ExternalEventDialog eventId={externalId} onClose={() => setExternalId(null)} />}</>;
  return { open, node };
}

export function CalendarPanel() {
  const data = useStore((s) => s.data);
  const setView = useStore((s) => s.setView);
  const today = useToday();
  const opener = useAgendaOpener();
  const [dlg, setDlg] = useState<null | 'event' | 'reminder'>(null);

  const items = useAgenda();
  const horizon = addDays(today, 14);
  const overdue = items.filter((i) => i.date < today && !i.done && (i.kind === 'deadline' || i.kind === 'project'));
  const upcoming = items.filter((i) => i.date >= today && i.date <= horizon && !i.done);
  const reminders = data.reminders.filter((r) => !r.deliveredAt || !r.ackedAt).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 8);

  return (
    <PanelShell title="Schedule" icon="🗓️" subtitle="Events, deadlines & reminders"
      actions={<button className="btn btn-ghost text-xs" onClick={() => setView('calendar')}>Month view →</button>}>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary" onClick={() => setDlg('event')}>＋ Event</button>
        <button className="btn" onClick={() => setDlg('reminder')}>＋ Reminder</button>
      </div>
      {overdue.length > 0 && <Section title="Missed deadlines"><Agenda items={overdue} onOpen={opener.open} /></Section>}
      <Section title="Next 14 days"><Agenda items={upcoming} onOpen={opener.open} empty="Nothing scheduled in the next two weeks. Add an event to get started." /></Section>
      <Section title="Reminders">
        {reminders.length === 0 ? <p className="text-sm text-ink-500">No active reminders.</p> : (
          <ul className="space-y-1">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-cream-100">
                <span aria-hidden>{r.deliveredAt ? '🔔' : '⏰'}</span>
                <span className="min-w-0 flex-1"><span className="block truncate">{r.title}</span><span className="text-xs text-ink-500">{r.at.replace('T', ' ')}{r.deliveredAt && ' · delivered'}</span></span>
                {r.deliveredAt && !r.ackedAt && <button className="btn btn-ghost px-2 text-xs" onClick={() => useStore.getState().ackReminder(r.id)}>Got it</button>}
                <button className="btn btn-ghost px-2 text-xs" aria-label={`Delete reminder ${r.title}`} onClick={() => useStore.getState().deleteReminder(r.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {dlg === 'event' && <EventDialog onClose={() => setDlg(null)} />}
      {dlg === 'reminder' && <ReminderDialog onClose={() => setDlg(null)} />}
      {opener.node}
    </PanelShell>
  );
}
