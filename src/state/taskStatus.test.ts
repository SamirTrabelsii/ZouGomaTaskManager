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
