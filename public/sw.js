// Minimal service worker: receives Web Push events and shows a native
// notification, and focuses/opens the app when the user taps it.
self.addEventListener("push", (event) => {
  let data = { title: "Lain", body: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Lain", {
      body: data.body || "",
      icon: "/lain-emblem.svg",
      badge: "/lain-emblem.svg",
      tag: "lain-reminder",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
