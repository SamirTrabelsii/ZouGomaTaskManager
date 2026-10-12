/** Registers the tiny notification service worker (no-op where unsupported). */
export function registerNotificationWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* notifications fall back to the page API */ });
}

export type NotifyResult = { ok: true; via: 'worker' | 'page' } | { ok: false; error: string };

/** Show a system notification. Prefers the service-worker registration, falls back to `new Notification`. */
export async function showSystemNotification(title: string, body: string, tag: string): Promise<NotifyResult> {
  if (typeof Notification === 'undefined') return { ok: false, error: 'This browser does not support notifications.' };
  if (Notification.permission !== 'granted') return { ok: false, error: `Permission is "${Notification.permission}".` };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, { body, tag, requireInteraction: false }); return { ok: true, via: 'worker' }; }
  } catch { /* try the page API */ }
  try {
    new Notification(title, { body, tag });
    return { ok: true, via: 'page' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
