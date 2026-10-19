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

interface Api {
  runtime: UiRuntime;
  post: (path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-actions-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  // A fresh database is seeded with GitHub, which is all these tests need.
  assert.ok(runtime.listAllServices().some((service) => service.id === "github"));
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    post: async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
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

// Roadmap 3.1: what a web push toast's buttons call from the service worker.
test("Ack records the acknowledgement and says it was the first", async () => {
  const app = await api();
  try {
    const { status, body } = await app.post("/providers/github/ack");
    assert.equal(status, 200);
    assert.equal((body as { newly: boolean }).newly, true);
    assert.equal((body as { by: string }).by, "web");
    assert.equal((await app.runtime.store.getAck("github"))?.ackedBy, "web");
  } finally {
    await app.close();
  }
});

test("a second Ack changes nothing and says so", async () => {
  const app = await api();
  try {
    await app.runtime.store.acknowledge("github", "telegram:op", "2026-09-17T10:00:00.000Z");
    const { status, body } = await app.post("/providers/github/ack");
    assert.equal(status, 200);
    assert.deepEqual(
      { newly: (body as { newly: boolean }).newly, by: (body as { by: string }).by },
      { newly: false, by: "telegram:op" },
    );
  } finally {
    await app.close();
  }
});

test("Mute writes the same mutedUntil the dashboard's own mute does, two hours by default", async () => {
  const app = await api();
  try {
    const before = Date.now();
    const { status, body } = await app.post("/providers/github/mute");
    assert.equal(status, 200);
    const until = Date.parse((body as { mutedUntil: string }).mutedUntil);
    assert.ok(Math.abs(until - (before + 120 * 60_000)) < 5_000, `mutedUntil ${until} is not two hours out`);
    const stored = app.runtime.listAllServices().find((service) => service.id === "github");
    assert.equal(stored?.mutedUntil, (body as { mutedUntil: string }).mutedUntil);
  } finally {
    await app.close();
  }
});

test("Mute takes a duration, within the same ceiling the /mute command has", async () => {
  const app = await api();
  try {
    assert.equal((await app.post("/providers/github/mute", { minutes: 30 })).status, 200);
    assert.equal((await app.post("/providers/github/mute", { minutes: 0 })).status, 400);
    assert.equal((await app.post("/providers/github/mute", { minutes: 30 * 24 * 60 + 1 })).status, 400);
    assert.equal((await app.post("/providers/github/mute", { minutes: "soon" })).status, 400);
  } finally {
    await app.close();
  }
});

test("a provider that does not exist is a 404 for both, and nothing is written", async () => {
  const app = await api();
  try {
    assert.equal((await app.post("/providers/ghost/ack")).status, 404);
    assert.equal((await app.post("/providers/ghost/mute")).status, 404);
    assert.equal(await app.runtime.store.getAck("ghost"), null);
  } finally {
    await app.close();
  }
});
