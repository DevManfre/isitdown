import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { NormalizedStatus } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  send: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-inc-api-"));
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
    send: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
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

const status = (provider: string, fetchedAt: string): NormalizedStatus => ({
  provider,
  overallStatus: "operational",
  activeIncidents: [],
  components: [],
  maintenances: [],
  fetchedAt,
});

interface LatencyBody {
  provider: string;
  range: string;
  slowMs: number | null;
  summary: { p50: number; p95: number; samples: number; overSlow: number | null } | null;
  points: { at: string; p50: number; p95: number; samples: number }[];
}

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

// Roadmap 4.14. The reading is on every sample; the chart is what asks for it.
test("latency comes back as percentiles per bucket, with the sample's own readings", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    for (const [minutes, latencyMs] of [[30, 100], [20, 200], [10, 900]] as const) {
      await app.runtime.store.saveStatus(status(providerId, minutesAgo(minutes)), { latencyMs });
    }

    const { status: code, body } = await app.get(`/history/latency?provider=${providerId}&range=24h`);
    const latency = body as LatencyBody;

    assert.equal(code, 200);
    assert.deepEqual(latency.summary, { p50: 200, p95: 900, samples: 3, overSlow: null });
    assert.equal(latency.slowMs, null);
    assert.equal(latency.points.reduce((sum, point) => sum + point.samples, 0), 3);
  } finally {
    await app.close();
  }
});

test("a sample with no reading is left out rather than counted as 0 ms", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    await app.runtime.store.saveStatus(status(providerId, minutesAgo(20)));
    await app.runtime.store.saveStatus(status(providerId, minutesAgo(10)), { latencyMs: 300 });

    const latency = (await app.get(`/history/latency?provider=${providerId}`)).body as LatencyBody;

    assert.equal(latency.summary?.samples, 1);
    assert.equal(latency.range, "7d");
  } finally {
    await app.close();
  }
});

test("a provider with nothing recorded answers a null summary and no points", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    const latency = (await app.get(`/history/latency?provider=${providerId}&range=30d`)).body as LatencyBody;
    assert.deepEqual([latency.summary, latency.points], [null, []]);
  } finally {
    await app.close();
  }
});

test("latency refuses an unknown range or provider and a missing one", async () => {
  const app = await api();
  try {
    const [providerId] = app.runtime.listAllServices().map((service) => service.id) as [string];
    assert.equal((await app.get(`/history/latency?provider=${providerId}&range=1y`)).status, 400);
    assert.equal((await app.get("/history/latency")).status, 400);
    assert.equal((await app.get("/history/latency?provider=nope")).status, 404);
  } finally {
    await app.close();
  }
});
