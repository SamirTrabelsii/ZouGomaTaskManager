import { useEffect } from 'react';
import { useStore } from '../state/store';

export function Inbox() {
  const open = useStore((s) => s.inboxOpen);
  const reminders = useStore((s) => s.data.reminders);
  const st = useStore.getState();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && st.toggleInbox(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, st]);
  if (!open) return null;
  const unread = reminders.filter((r) => r.deliveredAt && !r.ackedAt);
  const upcoming = reminders.filter((r) => !r.deliveredAt).sort((a, b) => a.at.localeCompare(b.at)).slice(0, 4);
  return (
    <div role="dialog" aria-label="Reminders" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[92vw] rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between"><h2 className="font-serif font-semibold">Reminders</h2><button className="btn btn-ghost px-2" aria-label="Close reminders" onClick={() => st.toggleInbox(false)}>✕</button></div>
      {unread.length === 0 && <p className="text-sm text-ink-500">You're all caught up.</p>}
      <ul className="space-y-2">
        {unread.map((r) => (
          <li key={r.id} className="card text-sm">
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-ink-500">Due {r.at.replace('T', ' ')}</div>
            <div className="mt-1 flex gap-1">
              <button className="btn text-xs" onClick={() => st.ackReminder(r.id)}>Got it</button>
              <button className="btn text-xs" onClick={() => st.snoozeReminder(r.id, 10)}>Snooze 10m</button>
              <button className="btn text-xs" onClick={() => st.snoozeReminder(r.id, 60)}>1h</button>
            </div>
          </li>
        ))}
      </ul>
      {upcoming.length > 0 && (
        <>
          <h3 className="label mt-3">Coming up</h3>
          <ul className="space-y-1 text-sm">{upcoming.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-ink-500">{r.at.replace('T', ' ')}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}
