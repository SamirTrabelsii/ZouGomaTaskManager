import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { toLocalInput } = await import('../domain/dates');

const NOW = new Date(2026, 5, 10, 12, 0, 0);
const at = (minutesFromNow: number) => toLocalInput(new Date(NOW.getTime() + minutesFromNow * 60000));

function seed(notificationsEnabled: boolean, reminders: { id: string; title: string; at: string }[]) {
  const d = emptyData();
  d.prefs.notifications.enabled = notificationsEnabled;
  d.reminders = reminders.map((r) => ({ ...r, link: null, deliveredAt: null, deliveredVia: null, ackedAt: null }));
  useStore.setState({ data: d, toasts: [] });
}
const rem = () => useStore.getState().data.reminders;

describe('reminder delivery', () => {
  let shown: { title: string; body?: string }[];
  beforeEach(() => {
    shown = [];
    class FakeNotification {
      static permission: NotificationPermission = 'granted';
      constructor(title: string, opts?: NotificationOptions) { shown.push({ title, body: opts?.body }); }
    }
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends a browser notification once for a due reminder when enabled and permitted', () => {
    seed(true, [{ id: 'a', title: 'Call Sam', at: at(-1) }]);
    useStore.getState().deliverDueReminders(NOW);
    useStore.getState().deliverDueReminders(NOW); // a second tick must not resend
    expect(shown).toEqual([{ title: 'LifeOS reminder', body: 'Call Sam' }]);
    expect(rem()[0].deliveredVia).toBe('browser');
    expect(rem()[0].deliveredAt).not.toBeNull();
  });

  it('does nothing for reminders that are not due yet', () => {
    seed(true, [{ id: 'a', title: 'Later', at: at(30) }]);
    useStore.getState().deliverDueReminders(NOW);
    expect(shown).toHaveLength(0);
    expect(rem()[0].deliveredAt).toBeNull();
  });

  it('falls back to in-app when the user has not enabled notifications', () => {
    seed(false, [{ id: 'a', title: 'Stretch', at: at(-1) }]);
    useStore.getState().deliverDueReminders(NOW);
    expect(shown).toHaveLength(0);
    expect(rem()[0].deliveredVia).toBe('in-app');
    expect(useStore.getState().toasts.some((t) => t.text.includes('Stretch'))).toBe(true);
  });

  it('falls back to in-app when browser permission is denied', () => {
    (Notification as unknown as { permission: string }).permission = 'denied';
    seed(true, [{ id: 'a', title: 'Water plants', at: at(-1) }]);
    useStore.getState().deliverDueReminders(NOW);
    expect(shown).toHaveLength(0);
    expect(rem()[0].deliveredVia).toBe('in-app');
  });

  it('does not pop an OS notification for a reminder missed by many hours', () => {
    seed(true, [{ id: 'a', title: 'Old', at: at(-60 * 8) }]);
    useStore.getState().deliverDueReminders(NOW);
    expect(shown).toHaveLength(0);
    expect(rem()[0].deliveredVia).toBe('in-app');
  });

  it('re-arms a snoozed reminder', () => {
    seed(true, [{ id: 'a', title: 'Snooze me', at: at(-1) }]);
    useStore.getState().deliverDueReminders(NOW);
    useStore.getState().snoozeReminder('a', 10);
    expect(rem()[0].deliveredAt).toBeNull();
  });
});
