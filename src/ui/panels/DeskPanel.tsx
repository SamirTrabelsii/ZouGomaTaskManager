import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { dailyProgress, dueTone, sortTasks } from '../../domain/services';
import type { TaskStatus } from '../../domain/types';
import { QuickAdd, ScopeBar, TaskList, TONE, useTaskDialog } from '../common/tasks';
import { StatusIcon, STATUS_NAME } from '../common/icons';
import { Ring } from '../common/ui';
import { PanelShell, Section, Tabs } from './PanelShell';

/** Only the active tab spells out its name – the others stay compact (icon + count) so all five fit the panel. */
function TabLabel({ status, active }: { status: TaskStatus; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" title={STATUS_NAME[status]}>
      <StatusIcon status={status} size={14} />
      <span className={active ? '' : 'sr-only'}>{STATUS_NAME[status]}</span>
    </span>
  );
}

export function DeskPanel() {
  const tasks = useStore((s) => s.data.tasks);
  const reminders = useStore((s) => s.data.reminders);
  const setView = useStore((s) => s.setView);
  const today = useToday();
  const dlg = useTaskDialog();
  const [tab, setTab] = useState<TaskStatus>('doing');
  const [scope, setScope] = useState('all');

  const prog = dailyProgress(tasks, today);
  const lists = useMemo(() => {
    const scoped = scope === 'all' ? tasks : tasks.filter((t) => t.scopeId === scope);
    const by = (s: TaskStatus) => sortTasks(scoped.filter((t) => t.status === s), 'due');
    const recentlyDone = scoped.filter((t) => t.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 30);
    return { todo: by('todo'), doing: by('doing'), blocked: by('blocked'), onhold: by('onhold'), done: recentlyDone };
  }, [tasks, scope]);
  const overdueCount = tasks.filter((t) => dueTone(t, today) === 'overdue').length;
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

      <QuickAdd defaults={{ dueDate: today, scopeId: scope === 'all' ? null : scope }} placeholder="Quick add for today — press Enter" />

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
        <div className="mb-2"><ScopeBar value={scope} onChange={setScope} /></div>
        <Tabs
          value={tab} onChange={setTab}
          tabs={[
            { id: 'todo', label: <TabLabel status="todo" active={tab === 'todo'} />, count: lists.todo.length },
            { id: 'doing', label: <TabLabel status="doing" active={tab === 'doing'} />, count: lists.doing.length },
            { id: 'blocked', label: <TabLabel status="blocked" active={tab === 'blocked'} />, count: lists.blocked.length },
            { id: 'onhold', label: <TabLabel status="onhold" active={tab === 'onhold'} />, count: lists.onhold.length },
            { id: 'done', label: <TabLabel status="done" active={tab === 'done'} /> },
          ]}
        />
        <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500" aria-label="Due date colours">
          {(['overdue', 'today', 'soon'] as const).map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span aria-hidden className={`inline-block h-3.5 w-0 border-l-2 ${TONE[k].bar}`} />
              {TONE[k].label}{k === 'overdue' && overdueCount > 0 && <span className="text-clay-600"> ({overdueCount})</span>}
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <TaskList
            tasks={lists[tab]} onEdit={(id) => dlg.open(id)}
            empty={{
              todo: { title: 'Nothing to do', hint: 'Add a task above, or enjoy the calm.' },
              doing: { title: 'Nothing in progress', hint: 'Start a task and it shows up here.' },
              blocked: { title: 'Nothing is blocked', hint: 'Tasks waiting on something or someone appear here.' },
              onhold: { title: 'Nothing on hold', hint: 'Park tasks you are deliberately not working on.' },
              done: { title: 'Nothing finished yet', hint: 'Completed tasks appear here.' },
            }[tab]}
          />
        </div>
      </Section>
      <button className="btn w-full" onClick={() => dlg.open(undefined, { dueDate: today })}>＋ New task with details</button>
      {dlg.node}
    </PanelShell>
  );
}
