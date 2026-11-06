import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function api() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-snapshots-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  return {
    runtime,
    call,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

type Summary = { id: number; name: string; services: number };

test("a snapshot is saved under its name, listed newest first, and deleted", async () => {
  const app = await api();
  try {
    assert.deepEqual((await app.call("GET", "/config/snapshots")).body, { snapshots: [] });

    const first = await app.call("POST", "/config/snapshots", { name: "  before-the-migration  " });
    assert.equal(first.status, 201);
    const saved = first.body as Summary;
    assert.equal(saved.name, "before-the-migration", "the name is trimmed");
    assert.equal(saved.services, app.runtime.listAllServices().length);

    await app.call("POST", "/config/snapshots", { name: "second" });
    const list = (await app.call("GET", "/config/snapshots")).body as { snapshots: Summary[] };
    assert.deepEqual(list.snapshots.map((s) => s.name), ["second", "before-the-migration"]);

    assert.equal((await app.call("DELETE", `/config/snapshots/${saved.id}`)).status, 204);
    assert.equal((await app.call("DELETE", `/config/snapshots/${saved.id}`)).status, 404);
  } finally {
    await app.close();
  }
});

test("a name is required and cannot be taken twice", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("POST", "/config/snapshots", {})).status, 400);
    assert.equal((await app.call("POST", "/config/snapshots", { name: "   " })).status, 400);
    assert.equal((await app.call("POST", "/config/snapshots", { name: "x".repeat(81) })).status, 400);

    assert.equal((await app.call("POST", "/config/snapshots", { name: "keep" })).status, 201);
    assert.equal((await app.call("POST", "/config/snapshots", { name: "keep" })).status, 409);
  } finally {
    await app.close();
  }
});

test("restoring puts the saved fleet back, after saving the one it replaces", async () => {
  const app = await api();
  try {
    const before = app.runtime.listAllServices().map((service) => service.id).sort();
    const snapshot = (await app.call("POST", "/config/snapshots", { name: "baseline" })).body as Summary;

    // Drift: remove a provider through the dashboard.
    const gone = before[0] as string;
    assert.equal((await app.call("DELETE", `/config/services/${gone}`)).status, 200);
    assert.equal(app.runtime.listAllServices().some((service) => service.id === gone), false);

    const preview = await app.call("GET", `/config/snapshots/${snapshot.id}/preview`);
    assert.equal(preview.status, 200);
    assert.deepEqual((preview.body as { services: { added: string[] } }).services.added, [gone]);

    const restore = await app.call("POST", `/config/snapshots/${snapshot.id}/restore`);
    assert.equal(restore.status, 200, JSON.stringify(restore.body));
    const { report, safety } = restore.body as { report: { added: string[] }; safety: Summary };
    assert.deepEqual(report.added, [gone]);
    assert.match(safety.name, /^Before restoring baseline /);
    assert.equal(safety.services, before.length - 1, "the safety copy is the drifted configuration");

    assert.deepEqual(app.runtime.listAllServices().map((service) => service.id).sort(), before);

    const names = ((await app.call("GET", "/config/snapshots")).body as { snapshots: Summary[] }).snapshots.map((s) => s.name);
    assert.ok(names.includes(safety.name));
  } finally {
    await app.close();
  }
});

test("an unknown snapshot is a 404 everywhere", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("GET", "/config/snapshots/99/preview")).status, 404);
    assert.equal((await app.call("POST", "/config/snapshots/99/restore")).status, 404);
    assert.equal((await app.call("POST", "/config/snapshots/abc/restore")).status, 404);
  } finally {
    await app.close();
  }
});
