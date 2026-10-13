import { useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { relativeDay } from '../../domain/dates';
import { dueTone } from '../../domain/services';
import type { Task, TaskStatus } from '../../domain/types';
import { applyFilters, defaultFilters, FilterBar, QuickAdd, ScopeBar, TaskList, TONE, useTaskDialog } from '../common/tasks';
import { Segmented } from '../common/ui';
import { CalendarIcon, PriorityIcon, PRIORITY_NAME, STATUS_COLOR, STATUS_NAME, StatusIcon } from '../common/icons';

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To do' }, { id: 'doing', title: 'In progress' }, { id: 'blocked', title: 'Blocked' },
  { id: 'onhold', title: 'On hold' }, { id: 'done', title: 'Done' },
];

export function TasksView() {
  const tasks = useStore((s) => s.data.tasks);
  const [mode, setMode] = useState<'list' | 'board'>('list');
  const [f, setF] = useState({ ...defaultFilters });
  const dlg = useTaskDialog();
  const shown = applyFilters(tasks, mode === 'board' ? { ...f, status: 'all' } : f);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 px-4 pb-20 pt-20 md:pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-2">
          <Segmented label="Layout" value={mode} onChange={setMode} options={[{ value: 'list', label: '☰ List' }, { value: 'board', label: '▦ Board' }]} />
          <button className="btn btn-primary" onClick={() => dlg.open()}>＋ New task</button>
        </div>
      </div>
      <ScopeBar value={f.scope} onChange={(scope) => setF({ ...f, scope })} />
      <FilterBar f={f} setF={setF} />
      {mode === 'list' && <QuickAdd defaults={f.scope === 'all' ? undefined : { scopeId: f.scope }} />}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {mode === 'list' ? (
          <div className="card"><TaskList tasks={shown} onEdit={(id) => dlg.open(id)} empty={{ title: tasks.length ? 'No tasks match these filters' : 'No tasks yet', hint: tasks.length ? 'Clear the search or change a filter.' : 'Add your first task above — it will also appear on your desk.' }} /></div>
        ) : (
          <Board tasks={shown} onEdit={(id) => dlg.open(id)} />
        )}
      </div>
      {dlg.node}
    </div>
  );
}

function DueChip({ task, today }: { task: Task; today: string }) {
  const tone = dueTone(task, today);
  const T = tone ? TONE[tone] : null;
  return <span className={`chip ${T?.chip ?? ''}`}>{T ? <T.Icon /> : <CalendarIcon />}{relativeDay(task.dueDate!, today)}</span>;
}

function ScopeChip({ scopeId }: { scopeId: string | null }) {
  const scope = useStore((s) => (scopeId ? s.data.scopes.find((x) => x.id === scopeId) : undefined));
  if (!scope) return null;
  return <span className="chip" style={{ borderColor: `${scope.color}99`, background: `${scope.color}1f` }}><span aria-hidden>{scope.icon}</span>{scope.title}</span>;
}

function Board({ tasks, onEdit }: { tasks: Task[]; onEdit: (id: string) => void }) {
  const update = useStore((s) => s.updateTask);
  const today = useToday();
  const [over, setOver] = useState<TaskStatus | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((c) => {
        const list = tasks.filter((t) => t.status === c.id);
        return (
          <section
            key={c.id} aria-label={`${c.title} column`}
            onDragOver={(e) => { e.preventDefault(); setOver(c.id); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) update(id, { status: c.id }); }}
            className={`rounded-xl border p-2 transition ${over === c.id ? 'border-moss-500 bg-moss-400/10' : 'border-cream-300 bg-cream-50/60'}`}
          >
            <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-semibold">
              <StatusIcon status={c.id} /><span className={c.id === 'todo' ? '' : STATUS_COLOR[c.id]}>{c.title}</span><span className="ml-auto text-ink-400">{list.length}</span>
            </h2>
            <ul className="space-y-2">
              {list.map((t) => (
                <li key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} className="card cursor-grab p-2.5 active:cursor-grabbing">
                  <button className="block w-full text-left text-sm font-medium" onClick={() => onEdit(t.id)}>{t.title}</button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.dueDate && <DueChip task={t} today={today} />}
                    <span className="chip"><PriorityIcon priority={t.priority} size={12} />{PRIORITY_NAME[t.priority]}</span>
                    <ScopeChip scopeId={t.scopeId} />
                  </div>
                  <select className="input mt-2 py-1 text-xs" aria-label={`Move “${t.title}” to`} value={t.status} onChange={(e) => update(t.id, { status: e.target.value as TaskStatus })}>
                    {Object.entries(STATUS_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </li>
              ))}
              {list.length === 0 && <li className="rounded-lg border border-dashed border-cream-300 p-4 text-center text-xs text-ink-400">Drop tasks here</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
