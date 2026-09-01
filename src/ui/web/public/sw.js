// Raised even with the dashboard closed: this is the whole point of the webpush
// channel. The payload is what src/notifiers/webpush.notifier.ts sends.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "IsItDown", {
      body: data.body || "",
      // One provider replaces its own previous toast instead of stacking five.
      tag: data.providerId || "isitdown",
      // Replacing a tagged notification is silent by default: the second
      // status change for the same provider would slip straight into the
      // notification centre with no banner and no sound, which reads as "push
      // is broken". `renotify` re-alerts on every replacement, and needs the
      // `tag` above to be set at all.
      renotify: true,
      // The provider's own icon when the notifier resolved one; omitted rather
      // than empty, so the browser falls back to its default instead of trying
      // to load "".
      ...(data.icon ? { icon: data.icon } : {}),
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.includes(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
