import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { goalProgress, projectProgress, sortMilestones, sortTasks } from '../../domain/services';
import { diffDays, formatDay, relativeDay } from '../../domain/dates';
import type { CertLevel, Certification, CertStatus, Goal, GoalTier, Project, ProjectStatus } from '../../domain/types';
import {
  certKey, CERT_REWARD, economyStart, formatBerries, goalKey, goalReward, GOAL_TIER_IDS, GOAL_TIERS, MILESTONE_REWARD, paidAmount, projectKey,
  projectReward, PROJECTS_PER_WEEK,
} from '../../domain/economy';
import { resolveTemplates } from '../../domain/templates';
import {
  CERT_LEVEL_IDS, CERT_LEVELS, CERT_STATUS, certReminderAt, certState, DEFAULT_CERT_LEVEL, DEFAULT_REMIND_BEFORE, EXPIRING_SOON_DAYS, formatCertDate, REMIND_OPTIONS, safeUrl, sortCerts,
  type CertState,
} from '../../domain/certs';
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
  const [tab, setTab] = useState<'projects' | 'goals' | 'certs'>(cfg.bookshelfTab);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [openGoal, setOpenGoal] = useState<string | null>(null);
  const [openCert, setOpenCert] = useState<string | null>(null);
  const [form, setForm] = useState<null | 'project' | 'goal' | 'cert'>(null);
  const [level, setLevel] = useState<CertLevel | 'all'>('all');
  const today = useToday();

  useEffect(() => {
    if (focus?.type === 'project') { setTab('projects'); setOpenProject(focus.id); }
    if (focus?.type === 'goal') { setTab('goals'); setOpenGoal(focus.id); }
    if (focus?.type === 'cert') { setTab('certs'); setOpenCert(focus.id); }
  }, [focus]);

  if (openProject && data.projects.some((p) => p.id === openProject)) return <ProjectDetail id={openProject} onBack={() => setOpenProject(null)} />;
  if (openGoal && data.goals.some((g) => g.id === openGoal)) return <GoalDetail id={openGoal} onBack={() => setOpenGoal(null)} />;
  if (openCert && data.certifications.some((c) => c.id === openCert)) return <CertDetail id={openCert} onBack={() => setOpenCert(null)} />;

  const projects = [...data.projects].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0));
  return (
    <PanelShell title="Projects & Goals" icon="📚" subtitle="Your long-term shelf">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'projects', label: 'Projects', count: data.projects.length },
        { id: 'goals', label: 'Goals', count: data.goals.length },
        { id: 'certs', label: 'Certifications', count: data.certifications.length },
      ]} />
      {tab === 'certs' ? (
        <>
          <button className="btn btn-primary w-full" onClick={() => setForm('cert')}>＋ New certification</button>
          {data.certifications.length === 0 ? (
            <EmptyState icon="🎓" title="No certifications yet" hint="Track the ones you're studying for, then keep the credential, its link and its expiry date here." />
          ) : (
            <>
            {data.certifications.length > 1 && (
              <Segmented label="Filter by level" value={level} onChange={setLevel}
                options={[{ value: 'all' as const, label: 'All' }, ...CERT_LEVEL_IDS.map((l) => ({ value: l, label: CERT_LEVELS[l].icon }))]} />
            )}
            <ul className="space-y-2">
              {sortCerts(data.certifications.filter((c) => level === 'all' || c.level === level), today).map((c) => (
                <li key={c.id}>
                  <button className="card w-full text-left transition hover:border-moss-500" onClick={() => setOpenCert(c.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium"><span title={CERT_LEVELS[c.level].label}>{CERT_LEVELS[c.level].icon}</span> {c.title}</span>
                      <CertChip state={certState(c, today)} />
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-xs text-ink-500">
                      <span className="truncate">{c.issuer}</span>
                      <span className="shrink-0">{certDateLine(c, today)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            </>
          )}
        </>
      ) : tab === 'projects' ? (
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
      {form === 'cert' && <CertForm onClose={() => setForm(null)} onSaved={(id) => setOpenCert(id)} />}
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

/* ───────── Certification ───────── */

const CERT_CHIP: Record<CertState, { label: string; className: string }> = {
  planned: { label: CERT_STATUS.planned, className: '' },
  studying: { label: CERT_STATUS.studying, className: '' },
  earned: { label: CERT_STATUS.earned, className: 'border-moss-500 text-moss-600' },
  expiring: { label: '⚠ Expiring soon', className: 'border-clay-400 text-clay-400' },
  expired: { label: '✕ Expired', className: 'border-clay-500 text-clay-600' },
};

function CertChip({ state }: { state: CertState }) {
  const c = CERT_CHIP[state];
  return <span className={`chip shrink-0 ${c.className}`}>{c.label}</span>;
}

/** The one date that matters right now: the exam while working toward it, the expiry once earned. */
function certDateLine(c: Certification, today: string): string {
  if (c.status !== 'earned') return c.examDate ? `Exam ${relativeDay(c.examDate, today, true)}` : '';
  if (!c.expiresOn) return 'No expiry';
  const left = diffDays(today, c.expiresOn);
  if (left < 0) return `Expired ${formatCertDate(c.expiresOn)}`;
  return left <= EXPIRING_SOON_DAYS ? `Expires in ${left} day${left === 1 ? '' : 's'}` : `Valid until ${formatCertDate(c.expiresOn)}`;
}

function CertReward({ cert }: { cert: Certification }) {
  const paid = useStore((s) => paidAmount(s.data.ledger, certKey(cert.id)));
  if (paid != null) return <RewardLine>Earned {formatBerries(paid)}</RewardLine>;
  return <RewardLine>{CERT_LEVELS[cert.level].label} · worth {formatBerries(CERT_REWARD[cert.level])} when earned</RewardLine>;
}

function CertRewardHint({ level, paid }: { level: CertLevel; paid: boolean }) {
  if (paid) return <RewardLine>Its reward is already paid; changing the level won't pay again.</RewardLine>;
  return <RewardLine>{CERT_LEVELS[level].label} pays {formatBerries(CERT_REWARD[level])} once, when marked earned</RewardLine>;
}

/** `earnNow` opens the form already switched to Earned, for the "I passed" button. */
function CertForm({ cert, earnNow, onClose, onSaved }: { cert?: Certification; earnNow?: boolean; onClose: () => void; onSaved?: (id: string) => void }) {
  const { addCert, updateCert, toast } = useStore.getState();
  const today = useToday();
  const [f, setF] = useState({
    title: cert?.title ?? '', issuer: cert?.issuer ?? '', level: cert?.level ?? DEFAULT_CERT_LEVEL, status: earnNow ? 'earned' : cert?.status ?? ('planned' as CertStatus),
    examDate: cert?.examDate ?? '', earnedOn: cert?.earnedOn ?? (earnNow ? today : ''), expiresOn: cert?.expiresOn ?? '',
    credentialId: cert?.credentialId ?? '', credentialUrl: cert?.credentialUrl ?? '', notes: cert?.notes ?? '',
    remindBefore: cert ? cert.remindBefore : DEFAULT_REMIND_BEFORE,
  });
  const [err, setErr] = useState('');
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setErr(''); };
  const earned = f.status === 'earned';
  return (
    <Dialog title={cert ? 'Edit certification' : 'New certification'} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!f.title.trim()) return setErr('A certification needs a name.');
        if (earned && f.credentialUrl.trim() && !safeUrl(f.credentialUrl)) return setErr('The credential link must be a web address (https://…).');
        if (earned && f.earnedOn && f.expiresOn && f.expiresOn < f.earnedOn) return setErr('It can’t expire before it was earned.');
        const patch = {
          ...f, title: f.title.trim(), issuer: f.issuer.trim(), credentialId: f.credentialId.trim(),
          examDate: f.examDate || null, earnedOn: earned ? f.earnedOn || null : null, expiresOn: earned ? f.expiresOn || null : null,
        };
        if (cert) updateCert(cert.id, patch); else onSaved?.(addCert(patch).id);
        // the store already celebrates a newly earned certification
        if (!(earned && cert?.status !== 'earned')) toast(cert ? 'Certification saved' : 'Certification added');
        onClose();
      }}>
        <Field label="Name"><input className="input" placeholder="AWS Solutions Architect – Associate" value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issuer"><input className="input" placeholder="Amazon Web Services" value={f.issuer} onChange={(e) => set({ issuer: e.target.value })} /></Field>
          <Field label="Level">
            <select className="input" value={f.level} onChange={(e) => set({ level: e.target.value as CertLevel })}>
              {CERT_LEVEL_IDS.map((l) => <option key={l} value={l}>{CERT_LEVELS[l].icon} {CERT_LEVELS[l].label}</option>)}
            </select>
          </Field>
        </div>
        <CertRewardHint level={f.level} paid={!!cert && paidAmount(useStore.getState().data.ledger, certKey(cert.id)) != null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as CertStatus, earnedOn: e.target.value === 'earned' && !f.earnedOn ? today : f.earnedOn })}>
              {Object.entries(CERT_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        {earned ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Earned on"><input type="date" className="input" value={f.earnedOn} onChange={(e) => set({ earnedOn: e.target.value })} /></Field>
              <Field label="Expires on"><input type="date" className="input" value={f.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Credential ID"><input className="input" value={f.credentialId} onChange={(e) => set({ credentialId: e.target.value })} /></Field>
              <Field label="Renewal reminder">
                <select className="input" value={f.remindBefore ?? ''} onChange={(e) => set({ remindBefore: e.target.value ? Number(e.target.value) : null })}>
                  {REMIND_OPTIONS.map((d) => <option key={d} value={d}>{d} days before expiry</option>)}
                  <option value="">No reminder</option>
                </select>
              </Field>
            </div>
            <Field label="Credential link"><input inputMode="url" className="input" placeholder="https://…" value={f.credentialUrl} onChange={(e) => set({ credentialUrl: e.target.value })} /></Field>
          </>
        ) : (
          <Field label="Exam date"><input type="date" className="input" value={f.examDate} onChange={(e) => set({ examDate: e.target.value })} /></Field>
        )}
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
    </Dialog>
  );
}

function CertDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const today = useToday();
  const [edit, setEdit] = useState<null | 'edit' | 'earn'>(null);
  const c = data.certifications.find((x) => x.id === id)!;
  const remindAt = certReminderAt(c, today);
  const rows: [string, ReactNode][] = [];
  if (c.issuer) rows.push(['Issuer', c.issuer]);
  if (c.status !== 'earned' && c.examDate) rows.push(['Exam', `${formatCertDate(c.examDate)} · ${relativeDay(c.examDate, today)}`]);
  if (c.status === 'earned') {
    if (c.earnedOn) rows.push(['Earned', formatCertDate(c.earnedOn)]);
    const left = c.expiresOn ? diffDays(today, c.expiresOn) : null;
    rows.push(['Expires', c.expiresOn
      ? `${formatCertDate(c.expiresOn)}${left! < 0 ? ' · expired' : left! <= EXPIRING_SOON_DAYS ? ` · in ${left} day${left === 1 ? '' : 's'}` : ''}`
      : 'Never']);
    if (c.credentialId) rows.push(['Credential ID', <span className="font-mono">{c.credentialId}</span>]);
    if (c.credentialUrl) rows.push(['Verify', <a className="break-all text-sky-500 underline" href={c.credentialUrl} target="_blank" rel="noopener noreferrer">{c.credentialUrl}</a>]);
    if (c.expiresOn) rows.push(['Reminder', remindAt ? `${formatCertDate(remindAt.slice(0, 10))} (${c.remindBefore} days before)` : 'None']);
  }
  return (
    <PanelShell title={c.title} icon={CERT_LEVELS[c.level].icon} subtitle={[CERT_LEVELS[c.level].label, c.issuer].filter(Boolean).join(' · ')}
      actions={<button className="btn btn-ghost px-2" onClick={() => setEdit('edit')} aria-label="Edit certification">✎</button>}>
      <button className="text-sm text-sky-500 underline" onClick={onBack}>← All certifications</button>
      <div className="card space-y-2">
        <CertChip state={certState(c, today)} />
        {rows.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {rows.flatMap(([k, v]) => [<dt key={`k-${k}`} className="text-ink-500">{k}</dt>, <dd key={`v-${k}`} className="min-w-0">{v}</dd>])}
          </dl>
        )}
        <CertReward cert={c} />
        {c.status !== 'earned' && <button className="btn btn-primary" onClick={() => setEdit('earn')}>🎓 I passed: mark as earned</button>}
      </div>
      {c.notes && <p className="whitespace-pre-wrap text-sm text-ink-700">{c.notes}</p>}
      <div className="flex justify-end">
        <ConfirmButton confirmLabel="Delete certification?" onConfirm={() => { st.deleteCert(id); onBack(); }}>Delete certification</ConfirmButton>
      </div>
      {edit && <CertForm cert={c} earnNow={edit === 'earn'} onClose={() => setEdit(null)} />}
    </PanelShell>
  );
}
