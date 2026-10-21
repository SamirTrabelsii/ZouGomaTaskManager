import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const { agendaItems } = await import('../domain/services');

const st = () => useStore.getState();
const certReminders = () => st().data.reminders.filter((r) => r.link?.type === 'cert');

describe('certification renewal reminder', () => {
  beforeEach(() => useStore.setState({ data: emptyData(), toasts: [] }));

  it('is created for an earned certification with an expiry date', () => {
    const c = st().addCert({ title: 'CKA', status: 'earned', expiresOn: '2099-03-01' });
    expect(certReminders()).toEqual([expect.objectContaining({ link: { type: 'cert', id: c.id }, at: '2098-12-31T09:00', deliveredAt: null })]);
    expect(certReminders()[0].title).toContain('CKA');
  });

  it('is not created while still studying, and appears once earned', () => {
    const c = st().addCert({ title: 'CKA', status: 'studying', examDate: '2099-01-10' });
    expect(certReminders()).toEqual([]);
    st().updateCert(c.id, { status: 'earned', earnedOn: '2099-01-10', expiresOn: '2101-01-10' });
    expect(certReminders()).toHaveLength(1);
  });

  it('moves (and re-arms) when the certification is renewed, and goes away when turned off', () => {
    const c = st().addCert({ title: 'CKA', status: 'earned', expiresOn: '2099-03-01', remindBefore: 30 });
    useStore.setState((s) => ({ data: { ...s.data, reminders: s.data.reminders.map((r) => ({ ...r, deliveredAt: '2099-01-30T09:00:00Z', ackedAt: 'x' })) } }));
    st().updateCert(c.id, { expiresOn: '2102-03-01' });
    expect(certReminders()).toEqual([expect.objectContaining({ at: '2102-01-30T09:00', deliveredAt: null, ackedAt: null })]);
    st().updateCert(c.id, { remindBefore: null });
    expect(certReminders()).toEqual([]);
  });

  it('is removed with the certification', () => {
    const c = st().addCert({ title: 'CKA', status: 'earned', expiresOn: '2099-03-01' });
    st().deleteCert(c.id);
    expect(st().data.certifications).toEqual([]);
    expect(certReminders()).toEqual([]);
  });

  it('never stores an unsafe credential link', () => {
    const c = st().addCert({ title: 'CKA', credentialUrl: 'javascript:alert(1)' });
    st().updateCert(c.id, { credentialUrl: 'JAVASCRIPT:alert(2)' });
    expect(st().data.certifications[0].credentialUrl).toBe('');
  });
});

describe('certification reward', () => {
  const certPayments = () => st().data.ledger.filter((e) => e.kind === 'cert');
  beforeEach(() => {
    useStore.setState({ data: emptyData(), toasts: [] });
    st().openTreasury();
  });

  it('pays its level the moment it is marked earned, with no waiting period', () => {
    const c = st().addCert({ title: 'CKA', level: 'professional', status: 'studying' });
    expect(certPayments()).toEqual([]);
    st().updateCert(c.id, { status: 'earned' });
    expect(certPayments()).toEqual([expect.objectContaining({ key: `cert:${c.id}`, amount: 1000 })]);
  });

  it('pays every level its agreed amount, also when added as already earned', () => {
    for (const level of ['badge', 'foundational', 'associate', 'professional', 'expert'] as const) {
      st().addCert({ title: level, level, status: 'earned' });
    }
    expect(certPayments().map((e) => e.amount)).toEqual([50, 100, 500, 1000, 3000]);
  });

  it('pays only once, even if unmarked, re-marked or moved to a higher level', () => {
    const c = st().addCert({ title: 'Badge', level: 'badge', status: 'earned' });
    st().updateCert(c.id, { status: 'studying' });
    st().updateCert(c.id, { status: 'earned', level: 'expert' });
    expect(certPayments().map((e) => e.amount)).toEqual([50]);
  });

  it('pays nothing before the treasury is opened', () => {
    useStore.setState({ data: emptyData() });
    st().addCert({ title: 'CKA', status: 'earned' });
    expect(certPayments()).toEqual([]);
  });
});

describe('certifications on the calendar', () => {
  it('shows the exam date until earned, then the expiry date', () => {
    useStore.setState({ data: emptyData() });
    const c = st().addCert({ title: 'CKA', status: 'studying', examDate: '2099-01-10' });
    expect(agendaItems(st().data).map((i) => [i.kind, i.date, i.title])).toEqual([['cert', '2099-01-10', 'CKA exam']]);
    st().updateCert(c.id, { status: 'earned', expiresOn: '2101-01-10' });
    expect(agendaItems(st().data).map((i) => [i.kind, i.date, i.title])).toEqual([['cert', '2101-01-10', 'CKA expires']]);
  });
});
