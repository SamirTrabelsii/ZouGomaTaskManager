import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { goalProgress, projectProgress, sortMilestones, sortTasks } from '../../domain/services';
import { formatDay, relativeDay } from '../../domain/dates';
import type { Goal, GoalTier, Project, ProjectStatus } from '../../domain/types';
import {
  economyStart, formatBerries, goalKey, goalReward, GOAL_TIER_IDS, GOAL_TIERS, MILESTONE_REWARD, paidAmount, projectKey,
  projectReward, PROJECTS_PER_WEEK,
} from '../../domain/economy';
import { resolveTemplates } from '../../domain/templates';
import { ConfirmButton, Dialog, EmptyState, Field, ProgressBar, Segmented } from '../common/ui';
import { QuickAdd, TaskList, useTaskDialog } from '../common/tasks';
import { PanelShell, Section, Tabs } from './PanelShell';

const STATUS: Record<ProjectStatus, string> = { active: '▶ Active', paused: '⏸ Paused', done: '✓ Complete' };

/** One quiet line about the Berries a project or goal earns; hidden until the treasury is opened. */
function RewardLine({ children }: { children: ReactNode }) {
  const started = useStore((s) => !!economyStart(s.data.ledger));
  return started ? <div className="mt-1 text-xs text-ink-500">🪙 {children}</div> : null;
}

function ProjectReward({ id }: { id: string }) {
  const data = useStore((s) => s.data);
  const today = useToday();
  const paid = paidAmount(data.ledger, projectKey(id));
  if (paid != null) return <RewardLine>Earned {formatBerries(paid)}</RewardLine>;
  const r = projectReward({ id }, data.tasks, data.ledger, today);
  return (
    <RewardLine>
      {r.amount
        ? <>Worth {formatBerries(r.amount)} when complete</>
        : r.capped
          ? <>This week's {PROJECTS_PER_WEEK} project rewards are used; it pays from Monday</>
          : <>Finish one of its tasks to earn Berries when complete</>}
    </RewardLine>
  );
}

function GoalRewardLine({ goal }: { goal: Goal }) {
  const ledger = useStore((s) => s.data.ledger);
  const today = useToday();
  const paid = paidAmount(ledger, goalKey(goal.id));
  if (paid != null) return <RewardLine>Earned {formatBerries(paid)}</RewardLine>;
  if (!goal.reward) return <RewardLine>No reward tier yet. Pick one with ✎</RewardLine>;
  const r = goalReward(goal, today);
  const chosen = GOAL_TIERS[goal.reward];
  return (
    <RewardLine>
      {chosen.label} · {formatBerries(chosen.amount)}
      {r.fullOn && <> · pays {formatBerries(r.amount)} if reached now, in full from {formatDay(r.fullOn)}</>}
    </RewardLine>
  );
}

export function BookshelfPanel() {
  const data = useStore((s) => s.data);
  const focus = useStore((s) => s.focus);
  const cfg = resolveTemplates(data.prefs.templates);
  const [tab, setTab] = useState<'projects' | 'goals'>(cfg.bookshelfTab);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openGoal, setOpenGoal] = useState<string | null>(null);
  const [form, setForm] = useState<null | 'project' | 'goal'>(null);
  const today = useToday();

  useEffect(() => {
    if (focus?.type === 'project') { setTab('projects'); setOpenProject(focus.id); }
    if (focus?.type === 'goal') { setTab('goals'); setOpenGoal(focus.id); }
  }, [focus]);

  if (openProject && data.projects.some((p) => p.id === openProject)) return <ProjectDetail id={openProject} onBack={() => setOpenProject(null)} />;
  if (openGoal && data.goals.some((g) => g.id === openGoal)) return <GoalDetail id={openGoal} onBack={() => setOpenGoal(null)} />;

  const projects = [...data.projects].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0));
  return (
    <PanelShell title="Projects & Goals" icon="📚" subtitle="Your long-term shelf">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'projects', label: 'Projects', count: data.projects.length }, { id: 'goals', label: 'Goals', count: data.goals.length }]} />
      {tab === 'projects' ? (
        <>
          <button className="btn btn-primary w-full" onClick={() => setForm('project')}>＋ New project</button>
          {projects.length === 0 ? (
            <EmptyState icon="📘" title="No projects yet" hint="Each project becomes a book on your shelf that fills as its tasks and milestones are completed." />
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => {
                const pr = projectProgress(p, data.tasks, data.milestones);
                return (
                  <li key={p.id}>
                    <button className="card w-full text-left transition hover:border-moss-500" onClick={() => setOpenProject(p.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{p.title}</span>
                        <span className="chip shrink-0">{STATUS[p.status]}</span>
                      </div>
                      <ProgressBar value={pr.ratio} label={`${p.title} progress`} className="mt-2" />
                      <div className="mt-1 flex justify-between text-xs text-ink-500">
                        <span>{pr.done}/{pr.total} items · {Math.round(pr.ratio * 100)}%</span>
                        {p.deadline && <span>Due {relativeDay(p.deadline, today)}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <button className="btn btn-primary w-full" onClick={() => setForm('goal')}>＋ New goal</button>
          {data.goals.length === 0 ? (
            <EmptyState icon="🏺" title="No goals yet" hint="Goals appear as jars on the top shelf and fill as you make progress." />
          ) : (
            <ul className="space-y-2">
              {data.goals.map((g) => {
                const pr = goalProgress(g);
                return (
                  <li key={g.id}>
                    <button className="card w-full text-left transition hover:border-moss-500" onClick={() => setOpenGoal(g.id)}>
                      <div className="flex justify-between gap-2"><span className="truncate font-medium">{g.title}</span><span className="text-sm text-ink-500">{g.current}/{g.target} {g.unit}</span></div>
                      <ProgressBar value={pr} label={`${g.title} progress`} className="mt-2" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {form === 'project' && <ProjectForm onClose={() => setForm(null)} onSaved={(id) => setOpenProject(id)} />}
      {form === 'goal' && <GoalForm onClose={() => setForm(null)} onSaved={(id) => setOpenGoal(id)} />}
    </PanelShell>
  );
}

/* ───────── Project ───────── */

function ProjectForm({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved?: (id: string) => void }) {
  const { addProject, updateProject, toast } = useStore.getState();
  const [f, setF] = useState({ title: project?.title ?? '', description: project?.description ?? '', deadline: project?.deadline ?? '', status: project?.status ?? ('active' as ProjectStatus) });
  const [err, setErr] = useState('');
  return (
    <Dialog title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return setErr('A project needs a title.');
        const patch = { title: f.title.trim(), description: f.description, deadline: f.deadline || null, status: f.status };
        if (project) updateProject(project.id, patch);
        else onSaved?.(addProject(patch).id);
        toast(project ? 'Project saved' : 'Project created');
        onClose();
      }}>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setErr(''); }} />{err && <span role="alert" className="text-xs text-clay-600">{err}</span>}</Field>
        <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deadline"><input type="date" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
              {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
    </Dialog>
  );
}

function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const today = useToday();
  const dlg = useTaskDialog();
  const [edit, setEdit] = useState(false);
  const [ms, setMs] = useState('');
  const [msDue, setMsDue] = useState('');
  const p = data.projects.find((x) => x.id === id)!;
  const pr = projectProgress(p, data.tasks, data.milestones);
  const milestones = sortMilestones(data.milestones.filter((m) => m.projectId === id));
  const tasks = sortTasks(data.tasks.filter((t) => t.projectId === id));
  return (
    <PanelShell title={p.title} icon="📘" subtitle={`${STATUS[p.status]}${p.deadline ? ` · due ${relativeDay(p.deadline, today)}` : ''}`}
      actions={<button className="btn btn-ghost px-2" onClick={() => setEdit(true)} aria-label="Edit project">✎</button>}>
      <button className="text-sm text-sky-500 underline" onClick={onBack}>← All projects</button>
      {p.description && <p className="text-sm text-ink-700">{p.description}</p>}
      <div className="card">
        <ProgressBar value={pr.ratio} label="Project progress" />
        <div className="mt-1 text-xs text-ink-500">{pr.done} of {pr.total} tasks &amp; milestones done · {Math.round(pr.ratio * 100)}%</div>
        <ProjectReward id={id} />
        {p.status !== 'done'
          ? <button className="btn mt-2" onClick={() => st.updateProject(id, { status: 'done' })}>Mark project complete</button>
          : <button className="btn mt-2" onClick={() => st.updateProject(id, { status: 'active' })}>Reopen project</button>}
      </div>

      <Section title="Milestones">
        <ul className="space-y-1">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cream-100">
              <button role="checkbox" aria-checked={m.done} aria-label={`Milestone: ${m.title}`} onClick={() => st.toggleMilestone(m.id)}
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-xs ${m.done ? 'border-moss-600 bg-moss-600 text-white' : 'border-ink-400'}`}>{m.done && '✓'}</button>
              <span className={`flex-1 text-sm ${m.done ? 'text-ink-400 line-through' : ''}`}>◆ {m.title}</span>
              {m.dueDate && <span className="chip">{relativeDay(m.dueDate, today)}</span>}
              <button className="btn btn-ghost px-1.5 text-xs" aria-label={`Delete milestone ${m.title}`} onClick={() => st.deleteMilestone(m.id)}>✕</button>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (ms.trim()) { st.addMilestone(id, ms, msDue || null); setMs(''); setMsDue(''); } }}>
          <input className="input" placeholder="Add a milestone…" aria-label="New milestone" value={ms} onChange={(e) => setMs(e.target.value)} />
          <input type="date" className="input w-36" aria-label="Milestone due date" value={msDue} onChange={(e) => setMsDue(e.target.value)} />
          <button className="btn" disabled={!ms.trim()}>Add</button>
        </form>
        <RewardLine>A milestone with a finished linked task earns {formatBerries(MILESTONE_REWARD)}</RewardLine>
      </Section>

      <Section title="Linked tasks">
        <QuickAdd defaults={{ projectId: id }} placeholder="Add a task to this project…" />
        <div className="mt-2"><TaskList tasks={tasks} onEdit={(tid) => dlg.open(tid)} empty={{ title: 'No tasks linked yet', hint: 'Tasks you add here count toward this project.' }} /></div>
      </Section>
      <div className="flex justify-end">
        <ConfirmButton confirmLabel="Delete project?" onConfirm={() => { st.deleteProject(id); onBack(); }}>Delete project</ConfirmButton>
      </div>
      {edit && <ProjectForm project={p} onClose={() => setEdit(false)} />}
      {dlg.node}
    </PanelShell>
  );
}

/* ───────── Goal ───────── */

function GoalForm({ goal, onClose, onSaved }: { goal?: Goal; onClose: () => void; onSaved?: (id: string) => void }) {
  const { addGoal, updateGoal, toast } = useStore.getState();
  const [f, setF] = useState({ title: goal?.title ?? '', description: goal?.description ?? '', unit: goal?.unit ?? '', target: goal?.target ?? 10, current: goal?.current ?? 0, deadline: goal?.deadline ?? '', reward: goal?.reward ?? ('S' as GoalTier) });
  const locked = !!goal?.reward;
  const [err, setErr] = useState('');
  return (
    <Dialog title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return setErr('A goal needs a title.');
        if (!(f.target > 0)) return setErr('Target must be greater than zero.');
        const patch = { ...f, title: f.title.trim(), deadline: f.deadline || null };
        if (goal) updateGoal(goal.id, patch); else onSaved?.(addGoal(patch).id);
        toast(goal ? 'Goal saved' : 'Goal created');
        onClose();
      }}>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setErr(''); }} />{err && <span role="alert" className="text-xs text-clay-600">{err}</span>}</Field>
        <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Current"><input type="number" min={0} className="input" value={f.current} onChange={(e) => setF({ ...f, current: Number(e.target.value) })} /></Field>
          <Field label="Target"><input type="number" min={1} className="input" value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} /></Field>
          <Field label="Unit"><input className="input" placeholder="books" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
        <Field label="Target date"><input type="date" className="input" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <div>
          <span className="label">Reward</span>
          {locked ? (
            <p className="text-sm">🔒 {GOAL_TIERS[f.reward].label} · {formatBerries(GOAL_TIERS[f.reward].amount)} <span className="text-xs text-ink-500">(locked once picked)</span></p>
          ) : (
            <>
              <Segmented label="Reward tier" value={f.reward} onChange={(reward) => setF({ ...f, reward })}
                options={GOAL_TIER_IDS.map((t) => ({ value: t, label: `${GOAL_TIERS[t].label} ${formatBerries(GOAL_TIERS[t].amount)}` }))} />
              <p className="mt-1 text-xs text-ink-500">
                Locked once saved. {GOAL_TIERS[f.reward].minDays > 0
                  ? `Pays in full if reached ${GOAL_TIERS[f.reward].minDays}+ days from now; sooner pays a smaller tier.`
                  : 'Pays as soon as the goal is reached.'}
              </p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
    </Dialog>
  );
}

function GoalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const dlg = useTaskDialog();
  const [edit, setEdit] = useState(false);
  const g = data.goals.find((x) => x.id === id)!;
  const pr = goalProgress(g);
  const tasks = sortTasks(data.tasks.filter((t) => t.goalId === id));
  return (
    <PanelShell title={g.title} icon="🏺" subtitle={`${g.current}/${g.target} ${g.unit}`} actions={<button className="btn btn-ghost px-2" onClick={() => setEdit(true)} aria-label="Edit goal">✎</button>}>
      <button className="text-sm text-sky-500 underline" onClick={onBack}>← All goals</button>
      {g.description && <p className="text-sm text-ink-700">{g.description}</p>}
      <div className="card">
        <ProgressBar value={pr} label="Goal progress" />
        <GoalRewardLine goal={g} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn" aria-label="Decrease progress" onClick={() => st.updateGoal(id, { current: Math.max(0, g.current - 1) })}>−</button>
          <span className="flex-1 text-center text-sm">{g.current} / {g.target} {g.unit} · {Math.round(pr * 100)}%</span>
          <button className="btn btn-primary" aria-label="Increase progress" onClick={() => st.updateGoal(id, { current: g.current + 1 })}>＋</button>
        </div>
      </div>
      <Section title="Linked tasks">
        <QuickAdd defaults={{ goalId: id }} placeholder="Add a task for this goal…" />
        <div className="mt-2"><TaskList tasks={tasks} onEdit={(tid) => dlg.open(tid)} empty={{ title: 'No tasks linked', hint: 'Link tasks to this goal from the task form.' }} /></div>
      </Section>
      <div className="flex justify-end"><ConfirmButton confirmLabel="Delete goal?" onConfirm={() => { st.deleteGoal(id); onBack(); }}>Delete goal</ConfirmButton></div>
      {edit && <GoalForm goal={g} onClose={() => setEdit(false)} />}
      {dlg.node}
    </PanelShell>
  );
}
