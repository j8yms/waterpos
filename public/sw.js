/* MIST POS service worker — dispatch push notification engine.
   - Persistent background worker registered at install time.
   - Fires a loud vibration-pattern notification (tag 'new-dispatch-alert',
     renotify true) whenever the server pushes a new dispatch order.
   - notificationclick auto-routes the operative URL (/pos/rider) or focuses
     the already-open app window. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Long-pulse vibration sequence: repeated three-beat "alert" pattern. */
const DISPATCH_VIBRATION = [
  200, 100, 200, 100, 200, 300, 500, 200, 300, 100, 200, 150, 400,
];

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "MIST POS", body: event.data.text() };
  }

  const data = payload || {};
  const title = data.title || "New Dispatch";
  const url = data.url || "/pos/rider";

  const options = {
    body: data.body || "An order has been assigned to you.",
    icon: data.icon || "/icons/notification-icon.png",
    badge: "/icons/badge.png",
    vibrate: data.vibrate || DISPATCH_VIBRATION,
    tag: "new-dispatch-alert",
    renotify: true,
    data: {
      url,
      dateOfArrival: Date.now(),
    },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const clickTarget = event.notification.data?.url || "/pos/rider";

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if ("focus" in client) {
          await client.navigate(clickTarget);
          return client.focus();
        }
      }

      if ("openWindow" in self.clients) {
        return self.clients.openWindow(clickTarget);
      }
    })()
  );
});

/* Minimal health message handler used by the PWA bootstrap to confirm the
   service worker is alive and controlling the page. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});