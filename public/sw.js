/* MIST POS service worker — dispatch push notification engine with continuous alarm for "Up for Grabs" orders and Ring Alarm broadcasts. */
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

/* Persistent alarm interval for "Up for Grabs" orders */
let upForGrabsAlarmInterval = null;

/* Persistent alarm interval for Ring Alarm broadcasts */
let ringAlarmInterval = null;

function startUpForGrabsAlarm(data) {
  if (upForGrabsAlarmInterval) return; // Already running

  upForGrabsAlarmInterval = setInterval(() => {
    self.registration.showNotification('🚨 UNASSIGNED DISPATCH ACTIVE!', {
      body: `${data.location} | ${data.product} | Collect: ${data.amount}`,
      tag: 'up-for-grabs',
      renotify: true,
      vibrate: [1000, 500, 1000, 500, 2000], // Persistent long pulsing alert blocks
      requireInteraction: true,
      data: { url: '/pos/rider', type: 'up-for-grabs', orderId: data.orderId },
    });

    // Broadcast message hook to any open client view frames to play an interactive alert sound chime
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'PLAY_ALARM_SOUND' }));
    });
  }, 4000);
}

function stopUpForGrabsAlarm() {
  if (upForGrabsAlarmInterval) {
    clearInterval(upForGrabsAlarmInterval);
    upForGrabsAlarmInterval = null;
  }
}

/* Ring Alarm (broadcast from management) */
function startRingAlarm(data) {
  if (ringAlarmInterval) return; // Already running

  ringAlarmInterval = setInterval(() => {
    self.registration.showNotification('🔔 RING ALARM: Management Calling!', {
      body: data.body || "Management is calling all riders!",
      tag: 'ring-alarm',
      renotify: true,
      vibrate: [500, 200, 500, 200, 1000, 500, 1000], // Strong pattern for ring alarm
      requireInteraction: true,
      data: { url: '/pos/rider', type: 'ring-alarm' },
    });

    // Broadcast message hook to any open client view frames to play an interactive alert sound chime
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'PLAY_ALARM_SOUND' }));
    });
  }, 5000); // Ring every 5 seconds
}

function stopRingAlarm() {
  if (ringAlarmInterval) {
    clearInterval(ringAlarmInterval);
    ringAlarmInterval = null;
  }
}

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

  // Handle "Up for Grabs" alarm type
  if (data.type === 'UP_FOR_GRABS_ALERT') {
    startUpForGrabsAlarm(data);
    return;
  }

  // Handle Ring Alarm broadcast from management
  if (data.type === 'RING_ALARM') {
    startRingAlarm(data);
    return;
  }

  // Handle clear-alarm command
  if (data.type === 'CLEAR_ALARM') {
    stopUpForGrabsAlarm();
    stopRingAlarm();
    return;
  }

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
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));

  // Notify any open client to play a sound
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: "PLAY_DISPATCH_SOUND" }));
    })()
  );
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

/* Message handler for PWA bootstrap and alarm control */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data && event.data.type === "CLEAR_ALARM") {
    stopUpForGrabsAlarm();
    stopRingAlarm();
  }
});