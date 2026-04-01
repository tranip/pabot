// PABot Service Worker
// Runs in the background — receives push events and shows notifications
// even when the browser tab is closed

self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      // Plain text fallback (e.g. DevTools test push)
      data = { title: 'PABot', body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'PABot', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      data:  { url: '/' }
    })
  );
});

// When a notification is tapped, open/focus the app
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
