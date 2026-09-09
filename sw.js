// Shopper Remote service worker (P-15, v2.92).
//
// Two jobs, and deliberately no third:
//   1. Show a push when the laptop reports that a run has stopped and
//      needs an answer.
//   2. Focus the app when that push is tapped.
//
// ⚠ It never answers a prompt, never caches state, and never acts on the
// run. A notification is a notification.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Shopper", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Shopper needs you", {
      body: data.body || "The Buy Queue is paused until you answer.",
      tag: data.tag || "shopper-prompt",
      renotify: true,
      icon: "icon-180.png",
      badge: "icon-180.png",
      data: { url: "index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow("index.html");
    })
  );
});
