import { describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
});
vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout });
vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });

const { useStore } = await import('./store');
const { emptyData } = await import('../data/storage');
const { nextScopeStyle, SCOPE_ICONS } = await import('../ui/common/icons');

const task = () => useStore.getState().data.tasks[0];

describe('blocked note and resume date', () => {
  it('are cleared when the task leaves the status they belong to', () => {
    useStore.setState({ data: emptyData(), toasts: [] });
    const { addTask, updateTask } = useStore.getState();
    const t = addTask({ title: 'Ship', status: 'blocked', blockedBy: 'legal review' });
    expect(task().blockedBy).toBe('legal review');
    updateTask(t.id, { status: 'onhold', resumeOn: '2026-05-01' });
    expect(task()).toMatchObject({ blockedBy: '', resumeOn: '2026-05-01' });
    updateTask(t.id, { status: 'doing' });
    expect(task()).toMatchObject({ blockedBy: '', resumeOn: null });
  });
});

describe('scope styles', () => {
  it('gives each new scope an icon and colour not used by the others', () => {
    const a = nextScopeStyle([]);
    const b = nextScopeStyle([a]);
    expect(b.icon).not.toBe(a.icon);
    expect(b.color).not.toBe(a.color);
    // once every icon is taken it cycles instead of failing
    const all = SCOPE_ICONS.map((icon) => ({ icon, color: '#000000' }));
    expect(SCOPE_ICONS).toContain(nextScopeStyle(all).icon);
  });
});

describe('completion rewards', () => {
  const open = () => {
    useStore.setState({ data: emptyData(), toasts: [] });
    useStore.getState().openTreasury();
  };
  const ledger = () => useStore.getState().data.ledger.filter((e) => e.kind !== 'welcome');

  it('buying the last missing base card of a set completes it and pays the set reward once', async () => {
    const { cardSet } = await import('../domain/cards');
    const { marketPrice, SET_REWARD } = await import('../domain/shop');
    const base = cardSet('OP-01')!.cards.filter((c) => c.variant === 'base');
    const last = base[base.length - 1];
    open();
    useStore.setState((s) => ({ data: {
      ...s.data,
      ledger: [...s.data.ledger, { id: 'x', key: 'test-funds', kind: 'weekly' as const, amount: 5000, at: s.data.ledger[0].at, label: 'funds' }],
      cards: { sealed: [], owned: Object.fromEntries(base.slice(0, -1).map((c) => [c.id, 1])) },
    } }));
    expect(useStore.getState().buyCard(last.id)).toBe(true);
    const kinds = ledger().filter((e) => e.key !== 'test-funds').map((e) => [e.kind, e.amount]);
    expect(kinds).toEqual([['purchase', -marketPrice(last)], ['collection', SET_REWARD]]);
    expect(useStore.getState().buyCard(last.id)).toBe(false);
    expect(ledger().filter((e) => e.kind === 'collection')).toHaveLength(1);
  });

  it('pay nothing before the treasury is opened', () => {
    useStore.setState({ data: emptyData(), toasts: [] });
    const { addGoal, updateGoal } = useStore.getState();
    const g = addGoal({ title: 'Read', target: 1, reward: 'S' });
    updateGoal(g.id, { current: 1 });
    expect(useStore.getState().data.ledger).toEqual([]);
  });

  it('a finished project pays once, even if reopened and finished again', () => {
    open();
    const { addProject, addTask, updateProject } = useStore.getState();
    const p = addProject({ title: 'Site' });
    addTask({ title: 'Build', projectId: p.id, size: 'XL', status: 'done' });
    updateProject(p.id, { status: 'done' });
    updateProject(p.id, { status: 'active' });
    updateProject(p.id, { status: 'done' });
    expect(ledger().map((e) => [e.kind, e.amount])).toEqual([['project', 200]]);
  });

  it('a project with no finished task pays nothing now but can still pay later', () => {
    open();
    const { addProject, addTask, updateProject } = useStore.getState();
    const p = addProject({ title: 'Tiny' });
    addTask({ title: 'One', projectId: p.id, size: 'S' });
    updateProject(p.id, { status: 'done' });
    expect(ledger()).toEqual([]);
    updateProject(p.id, { status: 'active' });
    addTask({ title: 'Two', projectId: p.id, size: 'S', status: 'done' });
    updateProject(p.id, { status: 'done' });
    expect(ledger().map((e) => e.amount)).toEqual([200]);
  });

  it('only 3 projects pay per week, and the toast says why', () => {
    open();
    const { addProject, addTask, updateProject } = useStore.getState();
    for (const title of ['A', 'B', 'C', 'D']) {
      const p = addProject({ title });
      addTask({ title: 'x', projectId: p.id, size: 'XS', status: 'done' });
      updateProject(p.id, { status: 'done' });
    }
    expect(ledger().map((e) => e.amount)).toEqual([200, 200, 200]);
    expect(useStore.getState().toasts.at(-1)?.text).toContain('rewards are used');
  });

  it('a milestone with finished work pays when ticked', () => {
    open();
    const { addProject, addMilestone, addTask, toggleMilestone } = useStore.getState();
    const p = addProject({ title: 'Site' });
    addMilestone(p.id, 'Beta');
    const m = useStore.getState().data.milestones[0];
    addTask({ title: 'Build', projectId: p.id, milestoneId: m.id, size: 'S', status: 'done' });
    toggleMilestone(m.id);
    toggleMilestone(m.id);
    toggleMilestone(m.id);
    expect(ledger().map((e) => e.amount)).toEqual([50]);
  });

  it('a goal pays when reached; its tier cannot be changed once picked', () => {
    open();
    const { addGoal, updateGoal } = useStore.getState();
    const g = addGoal({ title: 'Read', target: 2, reward: 'S' });
    updateGoal(g.id, { reward: 'XL' });
    expect(useStore.getState().data.goals[0].reward).toBe('S');
    updateGoal(g.id, { current: 2 });
    expect(ledger().map((e) => e.amount)).toEqual([300]);
  });

  it('an older goal without a tier may pick one, once', () => {
    open();
    const { addGoal, updateGoal } = useStore.getState();
    const g = addGoal({ title: 'Run' });
    updateGoal(g.id, { reward: 'M' });
    updateGoal(g.id, { reward: 'S' });
    expect(useStore.getState().data.goals[0]).toMatchObject({ reward: 'M' });
    expect(useStore.getState().data.goals[0].rewardSetAt).toBeTruthy();
  });
});

describe('the treasure chest', () => {
  it('opens the Treasury instead of a side panel', () => {
    useStore.setState({ data: emptyData(), toasts: [], selected: null, treasuryOpen: false });
    useStore.getState().select('chest');
    expect(useStore.getState()).toMatchObject({ treasuryOpen: true, selected: null });
  });
  it('sparkles when Berries come in', () => {
    useStore.setState({ data: emptyData(), toasts: [], pulse: {} });
    useStore.getState().openTreasury();
    expect(useStore.getState().pulse.chest?.celebrate).toBe(true);
  });
});
