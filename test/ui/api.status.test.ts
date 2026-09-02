import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { updateService } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  post: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-api-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: {},
    logger: silent,
  });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const request = async (method: string, path: string) => {
    const response = await fetch(`${base}${path}`, { method });
    const text = await response.text();
    return {
      status: response.status,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
    };
  };

  return {
    runtime,
    get: (path) => request("GET", path),
    post: (path) => request("POST", path),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("health reports ok with the number of providers it is watching", async () => {
  const app = await api();
  try {
    const { status, body } = await app.get("/health");
    assert.equal(status, 200);
    const health = body as { status: string; providers: number; lastCycleAt: string | null };
    assert.equal(health.status, "ok");
    assert.equal(health.providers, 3, "the seeded providers");
    assert.equal(health.lastCycleAt, null, "no cycle has run yet");
  } finally {
    await app.close();
  }
});

test("status lists every enabled provider with its current state", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "degraded",
      activeIncidents: [
        {
          id: "i1",
          name: "API requests failing",
          impact: "major",
          status: "investigating",
          updatedAt: "2026-08-19T14:00:00.000Z",
        },
      ],
      components: [],
      maintenances: [],
      fetchedAt: "2026-08-19T14:05:00.000Z",
    });

    const { status, body } = await app.get("/status");
    assert.equal(status, 200);
    const payload = body as {
      pollIntervalMinutes: number;
      providers: {
        id: string;
        name: string;
        baseUrl: string;
        adapter: string;
        overallStatus: string;
        activeIncidents: { id: string }[];
        uptime90: number;
      }[];
    };
    assert.equal(payload.pollIntervalMinutes, 3);
    assert.deepEqual(
      payload.providers.map((provider) => provider.id).sort(),
      ["anthropic", "cloudflare", "github"],
    );
    const github = payload.providers.find((provider) => provider.id === "github");
    assert.equal(github?.overallStatus, "degraded");
    assert.equal(github?.activeIncidents.length, 1);
    assert.equal(github?.baseUrl, "https://www.githubstatus.com");
    assert.equal(typeof github?.uptime90, "number");
  } finally {
    await app.close();
  }
});

test("status carries current component statuses and the selection", async () => {
  const app = await api();
  try {
    updateService(app.runtime.db, "github", { components: [{ id: "c1", name: "Actions" }] });
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [{ id: "c1", name: "Actions", status: "operational" }],
      maintenances: [],
      fetchedAt: "2026-08-19T14:05:00.000Z",
    });

    const { body } = await app.get("/status");
    const payload = body as {
      providers: {
        id: string;
        componentSelection: { id: string; name: string }[];
        components: { id: string; status: string }[];
      }[];
    };
    const provider = payload.providers.find((entry) => entry.id === "github");
    assert.deepEqual(provider?.componentSelection, [{ id: "c1", name: "Actions" }]);
    assert.equal(provider?.components[0]?.id, "c1");
    assert.ok(
      ["operational", "degraded", "partial_outage", "major_outage", "unknown"].includes(
        provider?.components[0]?.status ?? "",
      ),
    );
  } finally {
    await app.close();
  }
});

test("a provider never polled reports unknown rather than being omitted", async () => {
  const app = await api();
  try {
    const { body } = await app.get("/status");
    const payload = body as { providers: { id: string; overallStatus: string; fetchedAt: string | null }[] };
    const anthropic = payload.providers.find((provider) => provider.id === "anthropic");
    assert.equal(anthropic?.overallStatus, "unknown");
    assert.equal(anthropic?.fetchedAt, null);
  } finally {
    await app.close();
  }
});

test("reading status never triggers an upstream fetch", async () => {
  const app = await api();
  try {
    await app.get("/status");
    await app.get("/status");
    await app.get("/status");
    // A poll would have written samples; the dashboard polls this endpoint every
    // 30 seconds, so it must stay a pure read.
    const samples = await app.runtime.store.getRecentSamples("github", 10);
    assert.deepEqual(samples, []);
  } finally {
    await app.close();
  }
});

test("a manual poll runs one cycle and reports what it found", async () => {
  const app = await api();
  try {
    // No provider is reachable from the test, so the cycle fails per provider —
    // what matters is that the endpoint runs one and answers with its summary.
    const { status, body } = await app.post("/poll");
    assert.equal(status, 200);
    const summary = body as { providers: number; failed: number; changes: number };
    assert.equal(summary.providers, 3);
    assert.equal(summary.changes, 0, "a first cycle is a baseline");
  } finally {
    await app.close();
  }
});

test("an unknown path answers with JSON, not an HTML error page", async () => {
  const app = await api();
  try {
    const { status, body } = await app.get("/nope");
    assert.equal(status, 404);
    assert.match((body as { error: { message: string } }).error.message, /not found/i);
  } finally {
    await app.close();
  }
});

test("a bad method on a known path is refused rather than falling through", async () => {
  const app = await api();
  try {
    const { status } = await app.post("/status");
    assert.equal(status, 404);
  } finally {
    await app.close();
  }
});

test("samples older than the retention window are pruned at boot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-prune-"));
  const dbPath = join(dir, "isitdown.db");

  const first = await buildUiRuntime({ dbPath, env: {}, logger: silent });
  const ancient = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
  await first.store.saveStatus({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: ancient,
  });
  await first.close();

  const second = await buildUiRuntime({ dbPath, env: {}, logger: silent });
  assert.deepEqual(await second.store.getRecentSamples("github", 10), []);
  await second.close();
});

test("status hands the dashboard the deadline the scheduler will actually fire on", async () => {
  const app = await api();
  try {
    await app.post("/poll");
    const { body } = await app.get("/status");
    const { nextPollAt } = body as { nextPollAt: string | null };

    assert.equal(
      nextPollAt,
      app.runtime.scheduler.nextRunAt(),
      "a deadline computed from the interval instead of the armed timer parks the countdown at zero",
    );
    assert.ok(nextPollAt !== null && Date.parse(nextPollAt) > Date.now(), "a fresh cycle leaves the countdown running");
  } finally {
    await app.close();
  }
});
