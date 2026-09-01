import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

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
  };
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
    },
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

      expect(self.registration.showNotification).toHaveBeenCalledWith("🟡 GitHub", {
        body: "GitHub is now degraded.",
        tag: "github",
        data: { url: "/" },
      });
    });

    it("falls back to defaults when the push carries no data", async () => {
      const { self, dispatch } = loadServiceWorker();
      const { waitUntil, settle } = capture();

      dispatch("push", { data: null, waitUntil });
      await settle();

      expect(self.registration.showNotification).toHaveBeenCalledWith("IsItDown", {
        body: "",
        tag: "isitdown",
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
