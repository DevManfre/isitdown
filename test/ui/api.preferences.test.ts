import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  dbPath: string;
  request: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
  raw: (path: string) => Promise<Response>;
  close: () => Promise<void>;
}

async function api(dbPath?: string): Promise<Api> {
  const path = dbPath ?? join(await mkdtemp(join(tmpdir(), "isitdown-pref-")), "isitdown.db");
  const runtime = await buildUiRuntime({ dbPath: path, env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    runtime,
    dbPath: path,
    raw: (p) => fetch(`${base}${p}`),
    request: async (method, p, body) => {
      const response = await fetch(`${base}${p}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("preferences default to following the system theme and English", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("GET", "/api/preferences");
    assert.equal(status, 200);
    assert.deepEqual(body, { theme: "system", uiLocale: "en", notificationLocale: "en" });
  } finally {
    await app.close();
  }
});

test("a preference change round-trips and survives a restart", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("PATCH", "/api/preferences", {
      theme: "dark",
      uiLocale: "it",
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { theme: "dark", uiLocale: "it", notificationLocale: "en" });
    await app.close();

    const restarted = await api(app.dbPath);
    try {
      assert.deepEqual((await restarted.request("GET", "/api/preferences")).body, {
        theme: "dark",
        uiLocale: "it",
        notificationLocale: "en",
      });
    } finally {
      await restarted.close();
    }
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
});

test("the dashboard locale and the notification locale are independent", async () => {
  const app = await api();
  try {
    await app.request("PATCH", "/api/preferences", { uiLocale: "en", notificationLocale: "it" });
    const preferences = (await app.request("GET", "/api/preferences")).body as {
      uiLocale: string;
      notificationLocale: string;
    };
    assert.equal(preferences.uiLocale, "en");
    assert.equal(preferences.notificationLocale, "it");
    // The notification locale is what the notifiers render in.
    assert.equal((await app.runtime.configSource.load()).locale, "it");
  } finally {
    await app.close();
  }
});

test("an unknown theme or locale is refused", async () => {
  const app = await api();
  try {
    for (const patch of [{ theme: "sepia" }, { uiLocale: "xx" }, { notificationLocale: "klingon" }]) {
      const { status } = await app.request("PATCH", "/api/preferences", patch);
      assert.equal(status, 400, JSON.stringify(patch));
    }
  } finally {
    await app.close();
  }
});

test("a catalog is served for every available language", async () => {
  const app = await api();
  try {
    for (const language of ["en", "it"]) {
      const response = await app.raw(`/locales/${language}.json`);
      assert.equal(response.status, 200, language);
      const catalog = (await response.json()) as Record<string, string>;
      assert.equal(typeof catalog["nav.overview"], "string");
    }
  } finally {
    await app.close();
  }
});

test("an unavailable language is a 404 so the client can fall back to en", async () => {
  const app = await api();
  try {
    assert.equal((await app.raw("/locales/xx.json")).status, 404);
  } finally {
    await app.close();
  }
});

test("the locale route cannot be walked out of its directory", async () => {
  const app = await api();
  try {
    for (const attempt of [
      "/locales/..%2f..%2f..%2fetc%2fpasswd.json",
      "/locales/....%2f%2fpackage.json",
      "/locales/%2e%2e%2fpackage.json",
    ]) {
      const response = await app.raw(attempt);
      assert.ok(response.status === 404 || response.status === 400, `${attempt} -> ${response.status}`);
      const text = await response.text();
      assert.ok(!text.includes("isitdown\","), "no file outside the locales directory may be served");
      assert.ok(!text.includes("root:"), "no system file may be served");
    }
  } finally {
    await app.close();
  }
});
