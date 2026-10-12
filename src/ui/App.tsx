import { useEffect } from 'react';
import { useStore } from '../state/store';
import { useReminderEngine } from '../state/hooks';
import { registerNotificationWorker } from '../state/notify';
import { refreshPushTimezone } from '../state/push';
import type { ViewId } from '../domain/types';
import { Home } from './Home';
import { TasksView } from './views/TasksView';
import { CalendarView } from './views/CalendarView';
import { InsightsView } from './views/InsightsView';
import { Settings } from './Settings';
import { Inbox } from './Inbox';
import { Toasts } from './Toasts';
import { Recovery } from './Recovery';
import { AuthGate } from './AuthGate';
import { ConflictDialog, SyncChip } from './SyncStatus';

const TABS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'tasks', label: 'Tasks', icon: '☑️' },
  { id: 'calendar', label: 'Calendar', icon: '🗓️' },
  { id: 'insights', label: 'Insights', icon: '📈' },
];

export default function App() {
  const status = useStore((s) => s.status);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const saveError = useStore((s) => s.saveError);
  const unread = useStore((s) => s.data.reminders.filter((r) => r.deliveredAt && !r.ackedAt).length);
  const toggleInbox = useStore((s) => s.toggleInbox);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const reduce = useStore((s) => s.data.prefs.scene.reduceMotion);

  useEffect(() => { void useStore.getState().load(); registerNotificationWorker(); }, []);
  useReminderEngine(status === 'ready');
  const cloudEmail = useStore((s) => s.cloud.email);
  useEffect(() => { if (status === 'ready' && cloudEmail) void refreshPushTimezone(); }, [status, cloudEmail]);
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(reduce); }, [reduce]);

  if (status === 'loading') return <div role="status" className="flex h-full items-center justify-center font-serif text-xl text-ink-500">Opening your studio…</div>;
  if (status === 'corrupt') return <Recovery />;
  if (status === 'signin') return <AuthGate />;

  return (
    <div className="relative h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <header className="absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-2 px-3 py-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50/90 px-3 py-1.5 shadow-soft backdrop-blur-md">
          <span aria-hidden>🪴</span><span className="font-serif text-lg font-semibold">LifeOS</span>
        </div>
        <nav aria-label="Main" className="pointer-events-auto hidden rounded-2xl border border-cream-300 bg-cream-50/90 p-1 shadow-soft backdrop-blur-md md:flex">
          {TABS.map((t) => (
            <button key={t.id} aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${view === t.id ? 'bg-moss-600 text-white' : 'hover:bg-cream-200'}`}>{t.label}</button>
          ))}
        </nav>
        <div className="pointer-events-auto relative flex gap-1 rounded-2xl border border-cream-300 bg-cream-50/90 p-1 shadow-soft backdrop-blur-md">
          <SyncChip />
          <button className="btn btn-ghost relative px-2.5" onClick={() => toggleInbox()} aria-label={`Reminders${unread ? `, ${unread} unread` : ''}`}>
            🔔{unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-clay-500 px-1 text-[10px] text-white">{unread}</span>}
          </button>
          <button className="btn btn-ghost px-2.5" onClick={() => toggleSettings(true)} aria-label="Settings">⚙️</button>
          <Inbox />
        </div>
      </header>

      {saveError && (
        <div role="alert" className="absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-lg bg-clay-500 px-3 py-2 text-sm text-white shadow-soft">
          Couldn't save to this browser ({saveError}). Export your data from Settings to be safe.
        </div>
      )}

      <main id="main" className="h-full">
        {view === 'home' && <Home />}
        {view === 'tasks' && <TasksView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'insights' && <InsightsView />}
      </main>

      <nav aria-label="Main (mobile)" className="absolute inset-x-0 bottom-0 z-40 flex border-t border-cream-300 bg-cream-50/95 backdrop-blur-md md:hidden">
        {TABS.map((t) => (
          <button key={t.id} aria-current={view === t.id ? 'page' : undefined} onClick={() => setView(t.id)}
            className={`flex h-14 flex-1 flex-col items-center justify-center text-[11px] ${view === t.id ? 'font-semibold text-moss-700' : 'text-ink-500'}`}>
            <span aria-hidden className="text-lg">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {settingsOpen && <Settings />}
      <ConflictDialog />
      <Toasts />
    </div>
  );
}
