import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * sw.js is the last link in the desktop-push delivery chain and had no test at
 * all (review finding 7). It runs in the service worker global scope, not as a
 * module, so it references `self` directly rather than importing anything —
 * loading it here means executing its own source with a fake `self` standing
 * in for that scope. `new Function("self", source)` gives a function whose
 * body is the file's top-level code, with every `self.` reference inside it
 * bound to whatever object is passed in: no bundler and no service-worker
 * shim needed, and the real, shipped file is what runs, not a re-implementation
 * of its logic.
 *
 * The path is resolved with `node:path`, not `new URL("./sw.js", import.meta.url)`:
 * this suite runs under the happy-dom environment, which shims the global `URL`
 * constructor and resolves a relative string against `http://localhost:3000/`
 * instead of the `file:` base — silently pointing at the wrong file.
 */
const swSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sw.js"), "utf8");

interface FakeClient {
  url: string;
  focus: () => void;
}

interface FakeSelf {
  registration: {
    showNotification: ReturnType<typeof vi.fn>;
    scope: string;
  };
  clients: {
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
  };
  skipWaiting: ReturnType<typeof vi.fn>;
  location: { origin: string };
}

/**
 * A stand-in for the Cache Storage API, recording what the worker decided to
 * keep. The assertions that matter are about what is *absent* from it — an API
 * response in here would be a cached status reading (see sw.js).
 */
interface FakeCache {
  entries: Map<string, unknown>;
  addAll: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function loadServiceWorker(): { self: FakeSelf; dispatch: (type: string, event: unknown) => void } {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const fakeSelf: FakeSelf & { addEventListener: (type: string, handler: (event: unknown) => void) => void } = {
    addEventListener: (type, handler) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    registration: {
      showNotification: vi.fn().mockResolvedValue(undefined),
      scope: "https://localhost/",
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn().mockResolvedValue(undefined),
    },
    skipWaiting: vi.fn(),
    location: { origin: "https://localhost" },
  };

  new Function("self", swSource)(fakeSelf);

  return {
    self: fakeSelf,
    dispatch: (type, event) => {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

/** `event.waitUntil` is how a real ExtendableEvent lets a handler tell the
 * worker to stay alive until a promise settles; capturing what was passed
 * to it is how a test knows when the handler's async work is done. */
function capture(): { waitUntil: (promise: Promise<unknown>) => void; settle: () => Promise<unknown> } {
  let promise: Promise<unknown> = Promise.resolve();
  return {
    waitUntil: (p) => {
      promise = p;
    },
    settle: () => promise,
  };
}

describe("service worker (sw.js)", () => {
  describe("push", () => {
    it("shows a notification with the title, body and tag from the notifier's payload", async () => {
      const { self, dispatch } = loadServiceWorker();
      const { waitUntil, settle } = capture();
      // Exactly the shape src/notifiers/webpush.notifier.ts sends (the `kind`
      // field it used to carry was dropped in the same review pass — nothing
      // here reads it either).
      const payload = {
        title: "🟡 GitHub",
        body: "GitHub is now degraded.",
        url: "/",
        providerId: "github",
      };

      dispatch("push", { data: { json: () => payload }, waitUntil });
      await settle();

      // `renotify` is asserted here rather than in a test of its own: without
      // it a replacement for the same tag is delivered silently, so the second
      // change for a provider is only ever found by opening the notification
      // centre.
      expect(self.registration.showNotification).toHaveBeenCalledWith("🟡 GitHub", {
        body: "GitHub is now degraded.",
        tag: "github",
        renotify: true,
        data: { url: "/" },
      });
    });

    it("wears the provider's own icon when the notifier resolved one", async () => {
    const { self, dispatch } = loadServiceWorker();
    const { waitUntil, settle } = capture();

    dispatch("push", {
      data: {
        json: () => ({
          title: "🟡 GitHub",
          body: "GitHub is now degraded.",
          url: "/",
          providerId: "github",
          icon: "https://icons.duckduckgo.com/ip3/www.githubstatus.com.ico",
        }),
      },
      waitUntil,
    });
    await settle();

    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "🟡 GitHub",
      expect.objectContaining({ icon: "https://icons.duckduckgo.com/ip3/www.githubstatus.com.ico" }),
    );
  });

  it("falls back to defaults when the push carries no data", async () => {
      const { self, dispatch } = loadServiceWorker();
      const { waitUntil, settle } = capture();

      dispatch("push", { data: null, waitUntil });
      await settle();

      expect(self.registration.showNotification).toHaveBeenCalledWith("IsItDown", {
        body: "",
        tag: "isitdown",
        renotify: true,
        data: { url: "/" },
      });
    });
  });

  describe("notificationclick", () => {
    it("closes the toast and focuses an existing window rather than opening a new one", async () => {
      const { self, dispatch } = loadServiceWorker();
      const focus = vi.fn();
      const client: FakeClient = { url: "https://localhost/settings", focus };
      self.clients.matchAll.mockResolvedValue([client]);
      const { waitUntil, settle } = capture();
      const notification = { close: vi.fn(), data: { url: "/settings" } };

      dispatch("notificationclick", { notification, waitUntil });
      await settle();

      expect(notification.close).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledOnce();
      expect(self.clients.openWindow).not.toHaveBeenCalled();
    });

    it("opens a new window at the notification's url when no open client matches the scope", async () => {
      const { self, dispatch } = loadServiceWorker();
      self.clients.matchAll.mockResolvedValue([]);
      const { waitUntil, settle } = capture();
      const notification = { close: vi.fn(), data: { url: "/settings" } };

      dispatch("notificationclick", { notification, waitUntil });
      await settle();

      expect(self.clients.openWindow).toHaveBeenCalledWith("/settings");
    });
  });
});


/** The cache the worker opened, plus the keys it was asked to delete. */
function fakeCaches(): { cache: FakeCache; deleted: string[]; names: string[]; api: unknown } {
  const entries = new Map<string, unknown>();
  const deleted: string[] = [];
  const names = ["isitdown-shell-v1", "isitdown-shell-v0"];
  const cache: FakeCache = {
    entries,
    addAll: vi.fn(async (requests: { url?: string }[]) => {
      for (const request of requests) entries.set(String(request.url ?? request), "precached");
    }),
    put: vi.fn(async (key: unknown, value: unknown) => {
      entries.set(typeof key === "string" ? key : String((key as { url: string }).url), value);
    }),
  };
  return {
    cache,
    deleted,
    names,
    api: {
      open: vi.fn().mockResolvedValue(cache),
      keys: vi.fn().mockResolvedValue(names),
      delete: vi.fn(async (name: string) => {
        deleted.push(name);
        return true;
      }),
      match: vi.fn(async (key: unknown) => {
        const path = typeof key === "string" ? key : String((key as { url: string }).url);
        return entries.has(path) ? { cached: true, url: path } : undefined;
      }),
    },
  };
}

/** A fetch event as the worker sees it, with whatever the handler answered. */
function fetchEvent(url: string, init: { mode?: string; method?: string } = {}) {
  let answered: Promise<unknown> | undefined;
  return {
    request: { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" },
    respondWith: (promise: Promise<unknown>) => {
      answered = promise;
    },
    answered: () => answered,
  };
}

describe("service worker caching (roadmap 5.21)", () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it("precaches the shell on install, and nothing else", async () => {
    const { dispatch } = loadServiceWorker();
    const { cache, api } = fakeCaches();
    vi.stubGlobal("caches", api);
    const { waitUntil, settle } = capture();

    dispatch("install", { waitUntil });
    await settle();

    expect([...cache.entries.keys()].map((key) => new URL(key, "https://localhost").pathname).sort()).toEqual(
      ["/", "/favicon.svg", "/index.html", "/manifest.webmanifest"],
    );
  });

  it("sweeps caches from an older set of rules on activate", async () => {
    const { dispatch } = loadServiceWorker();
    const { deleted, api } = fakeCaches();
    vi.stubGlobal("caches", api);
    const { waitUntil, settle } = capture();

    dispatch("activate", { waitUntil });
    await settle();

    expect(deleted).toEqual(["isitdown-shell-v0"]);
  });

  it("never touches an API response — a cached status reading is the failure this avoids", async () => {
    const { dispatch } = loadServiceWorker();
    const { cache, api } = fakeCaches();
    vi.stubGlobal("caches", api);

    for (const path of ["/status", "/history?days=30", "/config", "/events", "/notifications"]) {
      const event = fetchEvent(`https://localhost${path}`);
      dispatch("fetch", event);
      // Not answered at all: the request falls straight through to the network.
      expect(event.answered(), `${path} must not be handled by the worker`).toBeUndefined();
    }
    expect(cache.entries.size).toBe(0);
  });

  it("leaves a write alone, whatever its path", async () => {
    const { dispatch } = loadServiceWorker();
    vi.stubGlobal("caches", fakeCaches().api);
    const event = fetchEvent("https://localhost/poll", { method: "POST" });
    dispatch("fetch", event);
    expect(event.answered()).toBeUndefined();
  });

  it("leaves another origin's request alone, fonts included", async () => {
    const { dispatch } = loadServiceWorker();
    vi.stubGlobal("caches", fakeCaches().api);
    const event = fetchEvent("https://fonts.gstatic.com/s/inter.woff2");
    dispatch("fetch", event);
    expect(event.answered()).toBeUndefined();
  });

  it("serves a hashed bundle from the cache once it has one", async () => {
    const { dispatch } = loadServiceWorker();
    const { cache, api } = fakeCaches();
    cache.entries.set("https://localhost/assets/index-abc123.js", "bundle");
    vi.stubGlobal("caches", api);
    globalThis.fetch = vi.fn() as unknown as typeof globalThis.fetch;

    const event = fetchEvent("https://localhost/assets/index-abc123.js");
    dispatch("fetch", event);
    await event.answered();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("goes to the network for the document first, so a deploy is picked up", async () => {
    const { dispatch } = loadServiceWorker();
    const { cache, api } = fakeCaches();
    vi.stubGlobal("caches", api);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      clone: () => ({ body: "fresh" }),
    }) as unknown as typeof globalThis.fetch;

    const event = fetchEvent("https://localhost/", { mode: "navigate" });
    dispatch("fetch", event);
    await event.answered();

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(cache.entries.get("/index.html")).toEqual({ body: "fresh" });
  });

  it("falls back to the cached shell when the server cannot be reached", async () => {
    // The point of the whole feature: the installed app opens to its own frame
    // on a flaky connection, and says so in its own words.
    const { dispatch } = loadServiceWorker();
    const { cache, api } = fakeCaches();
    cache.entries.set("/index.html", "shell");
    vi.stubGlobal("caches", api);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof globalThis.fetch;

    const event = fetchEvent("https://localhost/", { mode: "navigate" });
    dispatch("fetch", event);

    expect(await event.answered()).toEqual({ cached: true, url: "/index.html" });
  });
});
