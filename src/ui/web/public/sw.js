// Raised even when the dashboard is closed: that is the whole point of the
// webpush channel. The payload is what src/notifiers/webpush.notifier.ts sends.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "IsItDown", {
      body: data.body || "",
      // One provider replaces its own previous toast instead of stacking five.
      tag: data.providerId || "isitdown",
      // Replacing a tagged notification is silent by default: a second status
      // change for the same provider would slip straight into the notification
      // centre with no banner and no sound, which reads as "push is broken".
      // `renotify` re-alerts on every replacement, and needs `tag` above to be
      // set at all.
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

/* -------------------------------------------------------------------------
 * Installability and the offline shell — roadmap 5.21.
 *
 * The rule this file is built around: **no API response is ever cached.** A
 * monitoring dashboard that answers from a cache is worse than one that fails
 * to answer, because a cached "all operational" is indistinguishable from a
 * true one and is exactly the reading the operator acts on. So `/status`,
 * `/history`, `/events` and every other route go to the network or nowhere.
 *
 * What is cached is the shell: the document and the hashed bundle. That is what
 * makes the installed app open to its own frame on a flaky phone connection
 * rather than to the browser's dinosaur — and then say, in the app's own
 * words, that it cannot reach the server.
 * ------------------------------------------------------------------------- */

// Bumped when the caching rules themselves change. The asset names are content
// hashed by Vite, so a new build does not need a new cache name — it simply
// stops asking for the old entries, which `activate` then sweeps.
const CACHE = "isitdown-shell-v1";

/**
 * Everything else is API. Listed as prefixes rather than inferred, because
 * guessing wrong in this direction is what caches a status reading: an
 * unrecognised path falls through to the network, never to the cache.
 */
const SHELL_PREFIXES = ["/assets/", "/icons/"];
const SHELL_FILES = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload` so an install right after a deploy does not precache the very
      // bundle the deploy replaced, out of the HTTP cache.
      .then((cache) => cache.addAll(SHELL_FILES.map((path) => new Request(path, { cache: "reload" }))))
      // A failed precache must not leave the app with no worker at all: push
      // notifications are registered through this same file, and losing them
      // over a missed asset would be a monitoring tool going quiet.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const isShellAsset = (url) => SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Another origin's bytes are that origin's business — the fonts in
  // particular, which have their own HTTP cache and their own lifetime.
  if (url.origin !== self.location.origin) return;

  // The document itself: network first, so a deploy is picked up on the next
  // load, falling back to the cached shell when the server cannot be reached.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Hashed bundles and icons: cache first. The name changes when the content
  // does, so a hit is never stale by construction.
  if (isShellAsset(url) || SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else is the API. Left alone entirely: not cached, not served
  // from a cache, not even read-through. A stale status reading is the one
  // failure this whole file exists to avoid.
});
