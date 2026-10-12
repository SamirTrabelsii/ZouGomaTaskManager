import { ApiError, cloud } from '../data/cloud';

/**
 * Background reminders via Web Push. The browser holds a push subscription; the LifeOS server watches your
 * reminders and pushes them at the right time, even with no LifeOS tab open (the browser itself must be running,
 * except on phones where the OS delivers it).
 */

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

export type PushResult = { ok: true } | { ok: false; error: string };

export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, error: 'This browser does not support background push.' };
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Notification permission was not granted.' };
    const { publicKey } = await cloud.pushKey();
    const reg = await registration();
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
    await cloud.pushSubscribe(sub.toJSON(), timeZone());
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message };
    return { ok: false, error: (e as Error).message || 'Could not turn on background reminders.' };
  }
}

export async function disablePush(): Promise<PushResult> {
  try {
    const sub = await currentSubscription();
    if (sub) {
      await cloud.pushUnsubscribe(sub.endpoint).catch(() => { /* server entry is dropped when the browser reports it gone */ });
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Reminder times are wall-clock; keep the server's idea of this device's zone current (travel, DST, new device). */
export async function refreshPushTimezone() {
  try {
    const sub = await currentSubscription();
    if (sub && Notification.permission === 'granted') await cloud.pushSubscribe(sub.toJSON(), timeZone());
  } catch { /* offline or signed out: try again next time */ }
}

export async function sendTestPush(): Promise<PushResult & { delivered?: number }> {
  try {
    const r = await cloud.pushTest();
    return r.delivered > 0 ? { ok: true, delivered: r.delivered } : { ok: false, error: 'The server could not reach your browser’s push service.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
