import { useMemo, useState } from 'react';
import type { Priority, Task, TaskStatus } from '../../domain/types';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { relativeDay } from '../../domain/dates';
import { sortTasks } from '../../domain/services';
import { resolveTemplates } from '../../domain/templates';
import { ConfirmButton, Dialog, EmptyState, Field, PRIORITY_LABEL, STATUS_LABEL } from './ui';

/* ───────── Edit / create dialog ───────── */

export function TaskDialog({ taskId, defaults, onClose }: { taskId?: string; defaults?: Partial<Task>; onClose: () => void }) {
  const { tasks, projects, milestones, goals, reminders, prefs } = useStore((s) => s.data);
  const { addTask, updateTask, deleteTask, setTaskReminder, toast } = useStore.getState();
  const existing = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const cfg = resolveTemplates(prefs.templates);
  const rem = taskId ? reminders.find((r) => r.link?.type === 'task' && r.link.id === taskId) : undefined;

  const [f, setF] = useState<Partial<Task>>(() => existing ?? { title: '', notes: '', status: 'todo', priority: 'medium', dueDate: null, ...defaults });
  const [remindAt, setRemindAt] = useState(rem?.at ?? '');
  const [error, setError] = useState('');
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setF((p) => ({ ...p, [k]: v }));
  const projMs = milestones.filter((m) => m.projectId === f.projectId);
  const showProject = cfg.taskFields.has('project') || !!f.projectId;
  const showGoal = cfg.taskFields.has('goal') || !!f.goalId;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const title = (f.title ?? '').trim();
    if (!title) return setError('Give the task a title.');
    let id = taskId;
    if (existing) updateTask(existing.id, { ...f, title });
    else id = addTask({ ...f, title } as Task & { title: string }).id;
    if (id) setTaskReminder(id, remindAt || null);
    toast(existing ? 'Task saved' : 'Task added');
    onClose();
  };

  return (
    <Dialog title={existing ? 'Edit task' : 'New task'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Title">
          <input className="input" value={f.title ?? ''} onChange={(e) => { set('title', e.target.value); setError(''); }} placeholder="What needs doing?" aria-invalid={!!error} />
          {error && <span role="alert" className="mt-1 block text-xs text-clay-600">{error}</span>}
        </Field>
        <Field label="Notes">
          <textarea className="input min-h-[64px]" value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className="input" value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
          </Field>
          <Field label="Remind me at">
            <input type="datetime-local" className="input" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
          </Field>
        </div>
        {(showProject || showGoal) && (
          <div className="grid grid-cols-2 gap-3">
            {showProject && (
              <Field label="Project">
                <select className="input" value={f.projectId ?? ''} onChange={(e) => setF((p) => ({ ...p, projectId: e.target.value || null, milestoneId: null }))}>
                  <option value="">None</option>
                  {projects.filter((p) => p.status !== 'done' || p.id === f.projectId).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
            )}
            {showProject && f.projectId && (
              <Field label="Milestone">
                <select className="input" value={f.milestoneId ?? ''} onChange={(e) => set('milestoneId', e.target.value || null)}>
                  <option value="">None</option>
                  {projMs.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </Field>
            )}
            {showGoal && (
              <Field label="Goal">
                <select className="input" value={f.goalId ?? ''} onChange={(e) => set('goalId', e.target.value || null)}>
                  <option value="">None</option>
                  {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-2">
          {existing ? <ConfirmButton onConfirm={() => { deleteTask(existing.id); onClose(); }} confirmLabel="Delete task?">Delete</ConfirmButton> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{existing ? 'Save' : 'Add task'}</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/* ───────── Row ───────── */

export function TaskRow({ task, onEdit, compact }: { task: Task; onEdit: (id: string) => void; compact?: boolean }) {
  const today = useToday();
  const toggle = useStore((s) => s.toggleTask);
  const project = useStore((s) => s.data.projects.find((p) => p.id === task.projectId));
  const done = task.status === 'done';
  const overdue = !done && task.dueDate && task.dueDate < today;
  return (
    <li className="group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-cream-100">
      <button
        role="checkbox" aria-checked={done} aria-label={`${done ? 'Mark not done' : 'Complete'}: ${task.title}`}
        onClick={() => toggle(task.id)}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-xs transition ${done ? 'border-moss-600 bg-moss-600 text-white' : 'border-ink-400 hover:border-moss-600'}`}
      >
        {done && '✓'}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(task.id)} aria-label={`Edit ${task.title}`}>
        <div className={`truncate text-sm ${done ? 'text-ink-400 line-through' : ''}`}>{task.title}</div>
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {task.dueDate && (
              <span className={`chip ${overdue ? 'border-clay-500 text-clay-600' : ''}`}>
                {overdue ? '⚠ ' : '📅 '}{relativeDay(task.dueDate, today)}
              </span>
            )}
            {task.status === 'doing' && <span className="chip">◐ In progress</span>}
            {task.priority !== 'medium' && <span className="chip">{PRIORITY_LABEL[task.priority]}</span>}
            {project && <span className="chip">📘 {project.title}</span>}
          </div>
        )}
      </button>
      {compact && task.priority === 'high' && !done && <span className="chip" title="High priority">▲▲▲</span>}
    </li>
  );
}

/* ───────── Filtered list ───────── */

export interface TaskFilters { q: string; status: 'all' | 'open' | TaskStatus; priority: 'all' | Priority; project: string; sort: 'due' | 'priority' | 'created' | 'title' }
export const defaultFilters: TaskFilters = { q: '', status: 'open', priority: 'all', project: 'all', sort: 'due' };

export function applyFilters(tasks: Task[], f: TaskFilters): Task[] {
  const q = f.q.trim().toLowerCase();
  return sortTasks(
    tasks.filter((t) =>
      (!q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)) &&
      (f.status === 'all' || (f.status === 'open' ? t.status !== 'done' : t.status === f.status)) &&
      (f.priority === 'all' || t.priority === f.priority) &&
      (f.project === 'all' || (f.project === 'none' ? !t.projectId : t.projectId === f.project)),
    ),
    f.sort,
  );
}

export function FilterBar({ f, setF }: { f: TaskFilters; setF: (f: TaskFilters) => void }) {
  const projects = useStore((s) => s.data.projects);
  const up = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => setF({ ...f, [k]: v });
  return (
    <div className="flex flex-wrap gap-2" role="search" aria-label="Filter tasks">
      <input className="input min-w-[8rem] flex-1" type="search" placeholder="Search tasks…" value={f.q} onChange={(e) => up('q', e.target.value)} aria-label="Search tasks" />
      <select className="input w-auto" aria-label="Status" value={f.status} onChange={(e) => up('status', e.target.value as TaskFilters['status'])}>
        <option value="open">Open</option><option value="all">All</option><option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option>
      </select>
      <select className="input w-auto" aria-label="Priority" value={f.priority} onChange={(e) => up('priority', e.target.value as TaskFilters['priority'])}>
        <option value="all">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select>
      {projects.length > 0 && (
        <select className="input w-auto" aria-label="Project" value={f.project} onChange={(e) => up('project', e.target.value)}>
          <option value="all">All projects</option><option value="none">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
      <select className="input w-auto" aria-label="Sort by" value={f.sort} onChange={(e) => up('sort', e.target.value as TaskFilters['sort'])}>
        <option value="due">Sort: due date</option><option value="priority">Sort: priority</option><option value="created">Sort: newest</option><option value="title">Sort: title</option>
      </select>
    </div>
  );
}

export function TaskList({ tasks, onEdit, empty, compact }: { tasks: Task[]; onEdit: (id: string) => void; empty?: { title: string; hint?: string }; compact?: boolean }) {
  if (!tasks.length) return <EmptyState icon="🗒️" title={empty?.title ?? 'No tasks here'} hint={empty?.hint} />;
  return <ul className="space-y-0.5">{tasks.map((t) => <TaskRow key={t.id} task={t} onEdit={onEdit} compact={compact} />)}</ul>;
}

export function useTaskDialog() {
  const [dlg, setDlg] = useState<{ id?: string; defaults?: Partial<Task> } | null>(null);
  const node = useMemo(() => (dlg ? <TaskDialog taskId={dlg.id} defaults={dlg.defaults} onClose={() => setDlg(null)} /> : null), [dlg]);
  return { open: (id?: string, defaults?: Partial<Task>) => setDlg({ id, defaults }), node };
}

/** One-line quick add (Enter to submit). */
export function QuickAdd({ defaults, placeholder = 'Add a task and press Enter…' }: { defaults?: Partial<Task>; placeholder?: string }) {
  const [v, setV] = useState('');
  const add = useStore((s) => s.addTask);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { add({ ...defaults, title: v }); setV(''); } }} className="flex gap-2">
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label="Quick add task" />
      <button className="btn btn-primary" type="submit" disabled={!v.trim()}>Add</button>
    </form>
  );
}
