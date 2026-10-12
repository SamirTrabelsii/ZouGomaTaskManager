import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { dailyProgress, overdueTasks, sortTasks, todayTasks, upcomingTasks } from '../../domain/services';
import { relativeDay } from '../../domain/dates';
import { applyFilters, defaultFilters, FilterBar, QuickAdd, TaskList, useTaskDialog } from '../common/tasks';
import { Ring } from '../common/ui';
import { PanelShell, Section, Tabs } from './PanelShell';

export function DeskPanel() {
  const tasks = useStore((s) => s.data.tasks);
  const reminders = useStore((s) => s.data.reminders);
  const setView = useStore((s) => s.setView);
  const today = useToday();
  const dlg = useTaskDialog();
  const [tab, setTab] = useState<'today' | 'overdue' | 'upcoming' | 'all'>('today');
  const [filters, setFilters] = useState(defaultFilters);

  const prog = dailyProgress(tasks, today);
  const lists = useMemo(() => ({
    today: sortTasks(todayTasks(tasks, today), 'priority'),
    overdue: sortTasks(overdueTasks(tasks, today), 'due'),
    upcoming: sortTasks(upcomingTasks(tasks, today), 'due'),
    all: applyFilters(tasks, filters),
  }), [tasks, today, filters]);
  const priorities = sortTasks(tasks.filter((t) => t.status !== 'done' && t.priority === 'high'), 'due').slice(0, 3);
  const pendingReminders = reminders
    .filter((r) => r.at.slice(0, 10) <= today && !r.ackedAt && r.deliveredAt)
    .slice(0, 3);

  return (
    <PanelShell title="Daily HQ" icon="🖥️" subtitle="Today's work at a glance">
      <div className="card flex items-center gap-4">
        <Ring value={prog.ratio} size={64}>{prog.total ? `${prog.done}/${prog.total}` : '–'}</Ring>
        <div className="text-sm">
          <div className="font-medium">
            {prog.total === 0 ? 'A clear day' : prog.remaining === 0 ? 'Everything for today is done' : `${prog.remaining} left for today`}
          </div>
          <div className="text-ink-500">{prog.done} completed today</div>
        </div>
      </div>

      <QuickAdd defaults={{ dueDate: today }} placeholder="Quick add for today — press Enter" />

      {pendingReminders.length > 0 && (
        <Section title="Reminders">
          <ul className="space-y-1">
            {pendingReminders.map((r) => (
              <li key={r.id} className="card flex items-center gap-2 py-2 text-sm">
                <span aria-hidden>🔔</span><span className="flex-1 truncate">{r.title}</span>
                <button className="btn btn-ghost px-2 text-xs" onClick={() => useStore.getState().ackReminder(r.id)}>Got it</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {priorities.length > 0 && (
        <Section title="Top priorities">
          <TaskList tasks={priorities} onEdit={(id) => dlg.open(id)} compact />
        </Section>
      )}

      <Section
        title="Tasks"
        right={<button className="text-xs text-sky-500 underline" onClick={() => setView('tasks')}>Open board &amp; list →</button>}
      >
        <Tabs
          value={tab} onChange={setTab}
          tabs={[
            { id: 'today', label: 'Today', count: lists.today.length },
            { id: 'overdue', label: 'Overdue', count: lists.overdue.length },
            { id: 'upcoming', label: 'Upcoming', count: lists.upcoming.length },
            { id: 'all', label: 'All' },
          ]}
        />
        <div className="mt-2">
          {tab === 'all' && <div className="mb-2"><FilterBar f={filters} setF={setFilters} /></div>}
          <TaskList
            tasks={lists[tab]} onEdit={(id) => dlg.open(id)}
            empty={{
              today: { title: 'Nothing due today', hint: 'Add a task above, or enjoy the calm.' },
              overdue: { title: 'Nothing overdue', hint: 'You are all caught up.' },
              upcoming: { title: 'No upcoming tasks', hint: 'Tasks due in the next two weeks appear here.' },
              all: { title: 'No tasks match', hint: 'Try changing the filters.' },
            }[tab]}
          />
        </div>
        {tab === 'upcoming' && lists.upcoming[0]?.dueDate && (
          <p className="mt-2 text-xs text-ink-500">Next: {relativeDay(lists.upcoming[0].dueDate, today)}</p>
        )}
      </Section>
      <button className="btn w-full" onClick={() => dlg.open(undefined, { dueDate: today })}>＋ New task with details</button>
      {dlg.node}
    </PanelShell>
  );
}
