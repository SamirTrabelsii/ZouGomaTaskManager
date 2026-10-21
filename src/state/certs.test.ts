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

describe('certifications on the calendar', () => {
  it('shows the exam date until earned, then the expiry date', () => {
    useStore.setState({ data: emptyData() });
    const c = st().addCert({ title: 'CKA', status: 'studying', examDate: '2099-01-10' });
    expect(agendaItems(st().data).map((i) => [i.kind, i.date, i.title])).toEqual([['cert', '2099-01-10', 'CKA exam']]);
    st().updateCert(c.id, { status: 'earned', expiresOn: '2101-01-10' });
    expect(agendaItems(st().data).map((i) => [i.kind, i.date, i.title])).toEqual([['cert', '2101-01-10', 'CKA expires']]);
  });
});
