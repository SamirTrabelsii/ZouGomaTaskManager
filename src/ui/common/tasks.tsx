import { useMemo, useState } from 'react';
import type { Priority, Scope, Task, TaskSize, TaskStatus } from '../../domain/types';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { relativeDay } from '../../domain/dates';
import { dueTone, SIZE_POINTS, sortTasks, TASK_SIZES, type DueTone } from '../../domain/services';
import { resolveTemplates } from '../../domain/templates';
import { ConfirmButton, Dialog, EmptyState, Field } from './ui';
import {
  AlertIcon, CalendarIcon, ClockIcon, PencilIcon, PlusIcon, nextScopeStyle, PRIORITY_NAME, PriorityIcon, SCOPE_COLORS, SCOPE_ICONS, ScopeBadge, SizeChip, sizeLabel, STATUS_NAME, StatusIcon,
} from './icons';

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
              {Object.entries(STATUS_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {Object.entries(PRIORITY_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {f.status === 'blocked' && (
            <div className="col-span-2">
              <Field label="Blocked by">
                <input className="input" value={f.blockedBy ?? ''} onChange={(e) => set('blockedBy', e.target.value)} placeholder="What or who is it waiting on?" />
              </Field>
            </div>
          )}
          {f.status === 'onhold' && (
            <div className="col-span-2">
              <Field label="Resume on">
                <input type="date" className="input" value={f.resumeOn ?? ''} onChange={(e) => set('resumeOn', e.target.value || null)} />
              </Field>
            </div>
          )}
          <Field label="Size (story points)">
            <select className="input" value={f.size ?? ''} onChange={(e) => set('size', (e.target.value || null) as TaskSize | null)}>
              <option value="">Not sized</option>
              {TASK_SIZES.map((s) => <option key={s} value={s}>{sizeLabel(s)}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className="input" value={f.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} />
          </Field>
          <div className="col-span-2">
            <Field label="Remind me at">
              <input type="datetime-local" className="input" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
            </Field>
          </div>
        </div>
        <ScopeField value={f.scopeId ?? null} onChange={(id) => set('scopeId', id)} />
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

/* ───────── Scopes ───────── */

/** Create or edit a scope: a name, an emoji and a colour. */
function ScopeDialog({ scopeId, onClose, onCreated }: { scopeId?: string; onClose: () => void; onCreated?: (s: Scope) => void }) {
  const existing = useStore((s) => s.data.scopes.find((x) => x.id === scopeId));
  const { addScope, updateScope, deleteScope } = useStore.getState();
  const [title, setTitle] = useState(existing?.title ?? '');
  const taken = useStore((s) => s.data.scopes);
  const [icon, setIcon] = useState(() => existing?.icon ?? nextScopeStyle(taken).icon);
  const [color, setColor] = useState(() => existing?.color ?? nextScopeStyle(taken).color);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (existing) updateScope(existing.id, { title: title.trim(), icon, color });
    else onCreated?.(addScope({ title, icon, color }));
    onClose();
  };
  return (
    <Dialog title={existing ? 'Edit scope' : 'New scope'} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-ink-500">A scope groups related tasks under one label, like a folder or tag. It is not a task itself.</p>
        <Field label="Name">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website launch" autoFocus />
        </Field>
        <Field label="Icon">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
            {SCOPE_ICONS.map((i) => (
              <button
                key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition ${icon === i ? 'border-moss-500 bg-moss-400/15' : 'border-cream-300 hover:bg-cream-200'}`}
              >{i}</button>
            ))}
          </div>
        </Field>
        <Field label="Colour">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {SCOPE_COLORS.map((c) => (
              <button
                key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${color === c ? 'scale-110 border-ink-900' : 'border-transparent'}`} style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <div className="flex items-center justify-between pt-2">
          {existing ? <ConfirmButton onConfirm={() => { deleteScope(existing.id); onClose(); }} confirmLabel="Delete scope?">Delete</ConfirmButton> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim()}>{existing ? 'Save' : 'Create scope'}</button>
          </div>
        </div>
        {existing && <p className="text-xs text-ink-400">Deleting a scope keeps its tasks – they just lose the label.</p>}
      </form>
    </Dialog>
  );
}

/** Scope picker for the task dialog, with a one-line way to create a scope on the spot (icon and colour can be edited later). */
function ScopeField({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const scopes = useStore((s) => s.data.scopes);
  const [name, setName] = useState<string | null>(null);
  const create = () => {
    if (!name?.trim()) return;
    const made = useStore.getState().addScope({ title: name, ...nextScopeStyle(scopes) });
    onChange(made.id);
    setName(null);
  };
  return (
    <Field label="Scope">
      {name === null ? (
        <div className="flex gap-2">
          <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">No scope</option>
            {scopes.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.title}</option>)}
          </select>
          <button type="button" className="btn" onClick={() => setName('')} aria-label="Create a new scope" title="New scope"><PlusIcon /></button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New scope name" aria-label="New scope name" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
          />
          <button type="button" className="btn btn-primary" onClick={create} disabled={!name.trim()}>Create</button>
          <button type="button" className="btn" onClick={() => setName(null)}>Cancel</button>
        </div>
      )}
    </Field>
  );
}

/** Filter chips: all tasks or one scope. Also where scopes are created and edited. */
export function ScopeBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const scopes = useStore((s) => s.data.scopes);
  const tasks = useStore((s) => s.data.tasks);
  const [dlg, setDlg] = useState<{ id?: string } | null>(null);
  const open = (id: string) => tasks.filter((t) => t.scopeId === id && t.status !== 'done').length;
  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? 'border-moss-500 bg-moss-400/15 text-ink-900' : 'border-cream-300 text-ink-500 hover:bg-cream-200 hover:text-ink-900'}`;
  const current = scopes.find((s) => s.id === value);
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Scope">
      <button className={chip(value === 'all')} aria-pressed={value === 'all'} onClick={() => onChange('all')}>All</button>
      {scopes.map((s) => (
        <button
          key={s.id} className={chip(value === s.id)} aria-pressed={value === s.id} onClick={() => onChange(s.id)}
          style={value === s.id ? { borderColor: s.color, background: `${s.color}22` } : undefined}
        >
          <ScopeBadge scope={s} size={16} />{s.title}<span className="text-ink-400">{open(s.id)}</span>
        </button>
      ))}
      <button className={chip(false)} onClick={() => setDlg({})}><PlusIcon />Scope</button>
      {current && (
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setDlg({ id: current.id })} aria-label={`Edit scope ${current.title}`}><PencilIcon /></button>
      )}
      {dlg && <ScopeDialog scopeId={dlg.id} onClose={() => { if (dlg.id && !useStore.getState().data.scopes.some((s) => s.id === dlg.id)) onChange('all'); setDlg(null); }} onCreated={(s) => onChange(s.id)} />}
    </div>
  );
}

/** The status icon as a one-click control: a native select laid invisibly over the icon (accessible, never clipped by the panel). */
function StatusPicker({ task }: { task: Task }) {
  const update = useStore((s) => s.updateTask);
  return (
    <label className="relative mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-cream-200 focus-within:ring-2 focus-within:ring-moss-500" title={`Status: ${STATUS_NAME[task.status]} – click to change`}>
      <StatusIcon status={task.status} size={16} />
      <select
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={task.status}
        aria-label={`Status of ${task.title}`} onChange={(e) => update(task.id, { status: e.target.value as TaskStatus })}
      >
        {Object.entries(STATUS_NAME).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/* ───────── Row ───────── */

/** Due-date colours: red overdue, amber today, blue within a week, plain beyond. */
export const TONE: Record<DueTone, { bar: string; chip: string; label: string; Icon: typeof CalendarIcon }> = {
  overdue: { bar: 'border-l-clay-500', chip: 'border-clay-500 text-clay-600', label: 'Overdue', Icon: AlertIcon },
  today: { bar: 'border-l-moss-500', chip: 'border-moss-500 text-moss-400', label: 'Today', Icon: ClockIcon },
  soon: { bar: 'border-l-sky-500', chip: 'border-sky-500 text-sky-500', label: 'This week', Icon: CalendarIcon },
  later: { bar: 'border-l-cream-300', chip: '', label: 'Later', Icon: CalendarIcon },
};

export function TaskRow({ task, onEdit, compact, shortDays }: { task: Task; onEdit: (id: string) => void; compact?: boolean; shortDays?: boolean }) {
  const today = useToday();
  const toggle = useStore((s) => s.toggleTask);
  const project = useStore((s) => s.data.projects.find((p) => p.id === task.projectId));
  const scope = useStore((s) => (task.scopeId ? s.data.scopes.find((x) => x.id === task.scopeId) : undefined));
  const done = task.status === 'done';
  const tone = dueTone(task, today);
  const t = tone ? TONE[tone] : null;
  return (
    <li className={`group flex items-start gap-2.5 rounded-lg border-l-2 px-2 py-2 hover:bg-cream-100 ${t ? t.bar : 'border-l-transparent'}`}>
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
              <span className={`chip ${t?.chip ?? ''}`}>
                {t ? <t.Icon /> : <CalendarIcon />}{relativeDay(task.dueDate, today, shortDays)}
              </span>
            )}
            {task.priority !== 'medium' && (
              <span className="chip" title={`${PRIORITY_NAME[task.priority]} priority`}><PriorityIcon priority={task.priority} size={12} />{PRIORITY_NAME[task.priority]}</span>
            )}
            {task.size && <SizeChip size={task.size} />}
            {task.status === 'blocked' && task.blockedBy && (
              <span className="chip max-w-full border-clay-500/60" title={`Blocked by ${task.blockedBy}`}><StatusIcon status="blocked" size={12} /><span className="truncate">{task.blockedBy}</span></span>
            )}
            {task.status === 'onhold' && task.resumeOn && (
              <span className={`chip ${task.resumeOn <= today ? 'border-moss-500 text-moss-400' : ''}`}><StatusIcon status="onhold" size={12} />Resume {relativeDay(task.resumeOn, today, shortDays)}</span>
            )}
            {scope && (
              <span className="chip" style={{ borderColor: `${scope.color}99`, background: `${scope.color}1f` }} title={`Scope: ${scope.title}`}>
                <span aria-hidden>{scope.icon}</span>{scope.title}
              </span>
            )}
            {project && <span className="chip">📘 {project.title}</span>}
          </div>
        )}
      </button>
      <StatusPicker task={task} />
      {compact && task.priority === 'high' && !done && <span title="High priority" className="mt-0.5"><PriorityIcon priority="high" size={15} /></span>}
    </li>
  );
}

/* ───────── Filtered list ───────── */

export interface TaskFilters { q: string; scope: string; status: 'all' | 'open' | TaskStatus; priority: 'all' | Priority; size: 'all' | 'none' | TaskSize; project: string; sort: 'due' | 'priority' | 'created' | 'title' | 'size' }
export const defaultFilters: TaskFilters = { q: '', scope: 'all', status: 'open', priority: 'all', size: 'all', project: 'all', sort: 'due' };

export function applyFilters(tasks: Task[], f: TaskFilters): Task[] {
  const q = f.q.trim().toLowerCase();
  return sortTasks(
    tasks.filter((t) =>
      (!q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)) &&
      (f.status === 'all' || (f.status === 'open' ? t.status !== 'done' : t.status === f.status)) &&
      (f.scope === 'all' || t.scopeId === f.scope) &&
      (f.priority === 'all' || t.priority === f.priority) &&
      (f.size === 'all' || (f.size === 'none' ? !t.size : t.size === f.size)) &&
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
        <option value="open">Open</option><option value="all">All</option><option value="todo">To do</option><option value="doing">In progress</option><option value="blocked">Blocked</option><option value="onhold">On hold</option><option value="done">Done</option>
      </select>
      <select className="input w-auto" aria-label="Priority" value={f.priority} onChange={(e) => up('priority', e.target.value as TaskFilters['priority'])}>
        <option value="all">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
      </select>
      <select className="input w-auto" aria-label="Size" value={f.size} onChange={(e) => up('size', e.target.value as TaskFilters['size'])}>
        <option value="all">Any size</option><option value="none">Not sized</option>
        {TASK_SIZES.map((s) => <option key={s} value={s}>{s} · {SIZE_POINTS[s]} pts</option>)}
      </select>
      {projects.length > 0 && (
        <select className="input w-auto" aria-label="Project" value={f.project} onChange={(e) => up('project', e.target.value)}>
          <option value="all">All projects</option><option value="none">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}
      <select className="input w-auto" aria-label="Sort by" value={f.sort} onChange={(e) => up('sort', e.target.value as TaskFilters['sort'])}>
        <option value="due">Sort: due date</option><option value="priority">Sort: priority</option><option value="created">Sort: newest</option><option value="title">Sort: title</option><option value="size">Sort: size</option>
      </select>
    </div>
  );
}

export function TaskList({ tasks, onEdit, empty, compact, shortDays }: { tasks: Task[]; onEdit: (id: string) => void; empty?: { title: string; hint?: string }; compact?: boolean; shortDays?: boolean }) {
  if (!tasks.length) return <EmptyState icon="🗒️" title={empty?.title ?? 'No tasks here'} hint={empty?.hint} />;
  return <ul className="space-y-0.5">{tasks.map((t) => <TaskRow key={t.id} task={t} onEdit={onEdit} compact={compact} shortDays={shortDays} />)}</ul>;
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
