import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function api() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-prefs-map-"));
  const runtime: UiRuntime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: {},
    logger: silent,
  });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  return {
    call,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("mapView defaults to off", async () => {
  const app = await api();
  try {
    const { body } = await app.call("GET", "/api/preferences");
    assert.equal((body as { mapView: string }).mapView, "off");
  } finally {
    await app.close();
  }
});

test("mapView round-trips through a patch", async () => {
  const app = await api();
  try {
    const patched = await app.call("PATCH", "/api/preferences", { mapView: "globe" });
    assert.equal(patched.status, 200);
    assert.equal((patched.body as { mapView: string }).mapView, "globe");

    const reread = await app.call("GET", "/api/preferences");
    assert.equal((reread.body as { mapView: string }).mapView, "globe");
  } finally {
    await app.close();
  }
});

test("an unknown mapView is rejected with 400", async () => {
  const app = await api();
  try {
    const { status } = await app.call("PATCH", "/api/preferences", { mapView: "hologram" });
    assert.equal(status, 400);
  } finally {
    await app.close();
  }
});
