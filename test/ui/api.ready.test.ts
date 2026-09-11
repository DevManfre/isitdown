import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-ready-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

/** A provider whose "status page" is whatever the test hands it. */
async function fakeProvider(answer: { status: number; body: string }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((_req, res) => {
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("liveness answers ok before any cycle has run — the process is up", async () => {
  const app = await api();
  try {
    const { status, body } = await app.get("/health");
    assert.equal(status, 200);
    assert.equal((body as { status: string }).status, "ok");
  } finally {
    await app.close();
  }
});

test("readiness answers 503 before any cycle has run", async () => {
  const app = await api();
  try {
    const { status, body } = await app.get("/ready");
    assert.equal(status, 503);
    const report = body as { status: string; lastCycleAt: string | null; reason: string };
    assert.equal(report.status, "not_ready");
    assert.equal(report.lastCycleAt, null);
    assert.match(report.reason, /no poll cycle/);
  } finally {
    await app.close();
  }
});

test("readiness answers 200 once a cycle has read the fleet", async () => {
  const app = await api();
  const provider = await fakeProvider({
    status: 200,
    body: JSON.stringify({ status: { indicator: "none" }, incidents: [] }),
  });
  try {
    app.runtime.db.prepare("DELETE FROM services WHERE id != 'github'").run();
    app.runtime.db.prepare("UPDATE services SET base_url = ? WHERE id = 'github'").run(provider.baseUrl);

    await app.runtime.scheduler.triggerNow();

    const { status, body } = await app.get("/ready");
    assert.equal(status, 200);
    const report = body as { status: string; failed: number; providers: number; lastCycleAt: string };
    assert.equal(report.status, "ready");
    assert.equal(report.failed, 0);
    assert.equal(report.providers, 1);
    assert.notEqual(report.lastCycleAt, null);
  } finally {
    await provider.close();
    await app.close();
  }
});

test("readiness answers 503 when the cycle read nothing at all", async () => {
  const app = await api();
  const broken = await fakeProvider({ status: 500, body: "nope" });
  try {
    app.runtime.db.prepare("DELETE FROM services WHERE id != 'github'").run();
    app.runtime.db.prepare("UPDATE services SET base_url = ? WHERE id = 'github'").run(broken.baseUrl);
    // One attempt per provider: the point is the cycle's outcome, not the
    // backoff, and three retries would spend seconds proving the same thing.
    app.runtime.db.prepare("UPDATE settings SET value = '1' WHERE key = 'maxRetries'").run();

    await app.runtime.scheduler.triggerNow();

    const { status, body } = await app.get("/ready");
    assert.equal(status, 503);
    const report = body as { status: string; failed: number; reason: string };
    assert.equal(report.status, "not_ready");
    assert.equal(report.failed, 1);
    assert.match(report.reason, /every provider failed/);
  } finally {
    await broken.close();
    await app.close();
  }
});
