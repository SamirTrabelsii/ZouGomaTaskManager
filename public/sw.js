// LifeOS service worker.
//  - shows notifications through the registration (more reliable than `new Notification`)
//  - receives Web Push messages from the LifeOS server, so reminders can arrive while no tab is open
//  - focuses (or opens) the app when a notification is clicked
// It never reads or stores your data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = { title: 'LifeOS', body: 'You have a reminder.', tag: 'lifeos-push', url: '/' };
  try { if (event.data) msg = { ...msg, ...event.data.json() }; } catch { /* keep the generic message */ }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag, // same tag as the in-app notification, so the two never stack
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: msg.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list[0];
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
