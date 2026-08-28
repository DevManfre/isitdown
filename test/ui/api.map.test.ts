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
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-map-api-"));
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

interface MapBody {
  points: {
    providerId: string;
    providerName: string;
    componentId: string;
    name: string;
    lat: number;
    lon: number;
    status: string;
    source: string;
  }[];
  unlocated: { providerId: string; providerName: string; count: number }[];
  generatedAt: string | null;
}

// `buildUiRuntime` seeds default rows for "github", "cloudflare" and
// "anthropic" on a fresh database, so this upserts rather than inserts —
// otherwise seeding one of those ids collides with the default row instead
// of just asserting the state this test needs.
const seed = (runtime: UiRuntime, providerId: string, providerName: string) => {
  runtime.db
    .prepare(
      `INSERT INTO services (id, name, adapter, base_url, enabled, scope_to_components, created_at)
       VALUES (?, ?, 'statuspage', 'https://example.com', 1, 0, '2026-08-27T00:00:00.000Z')
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, enabled = excluded.enabled, scope_to_components = excluded.scope_to_components`,
    )
    .run(providerId, providerName);
};

test("no map data yet serves an empty map", async () => {
  const app = await api();
  try {
    const { status, body } = await app.get("/map");
    assert.equal(status, 200);
    const payload = body as MapBody;
    assert.deepEqual(payload.points, []);
    assert.deepEqual(payload.unlocated, []);
    assert.equal(payload.generatedAt, null);
  } finally {
    await app.close();
  }
});

test("a point carries its provider's display name", async () => {
  const app = await api();
  try {
    seed(app.runtime, "cloudflare", "Cloudflare");
    app.runtime.mapStore.replaceProvider(
      "cloudflare",
      [
        {
          componentId: "c1",
          name: "Amsterdam, Netherlands - (AMS)",
          lat: 52.31,
          lon: 4.76,
          source: "iata",
          status: "operational",
          observedAt: "2026-08-27T10:00:00.000Z",
        },
      ],
      { located: 1, total: 12, checkedAt: "2026-08-27T10:00:00.000Z" },
    );

    const payload = (await app.get("/map")).body as MapBody;
    assert.equal(payload.points.length, 1);
    assert.equal(payload.points[0]?.providerName, "Cloudflare");
    assert.equal(payload.unlocated[0]?.count, 11);
    assert.equal(payload.generatedAt, "2026-08-27T10:00:00.000Z");
  } finally {
    await app.close();
  }
});

test("generatedAt is the oldest observed_at, not the response time", async () => {
  // Oldest, not newest: the newest observation across a snapshot is the most
  // optimistic reading available and masks a stale provider behind a
  // freshly-polled one. The card's staleness signal must report the point an
  // operator would actually distrust.
  const app = await api();
  try {
    seed(app.runtime, "cloudflare", "Cloudflare");
    const point = (componentId: string, observedAt: string) => ({
      componentId,
      name: `Somewhere - (AMS)`,
      lat: 1,
      lon: 2,
      source: "iata" as const,
      status: "operational" as const,
      observedAt,
    });
    app.runtime.mapStore.replaceProvider(
      "cloudflare",
      [point("a", "2026-08-27T09:00:00.000Z"), point("b", "2026-08-27T10:00:00.000Z")],
      { located: 2, total: 2, checkedAt: "2026-08-27T10:00:00.000Z" },
    );

    const payload = (await app.get("/map")).body as MapBody;
    assert.equal(payload.generatedAt, "2026-08-27T09:00:00.000Z");
    // located === total, so nothing is unplaced and the provider must not
    // appear with count: 0 — the filter at map.routes.ts:47 is what this pins.
    assert.deepEqual(payload.unlocated, []);
  } finally {
    await app.close();
  }
});

test("a disabled provider is excluded from points and unlocated alike", async () => {
  const app = await api();
  try {
    seed(app.runtime, "cloudflare", "Cloudflare");
    app.runtime.mapStore.replaceProvider(
      "cloudflare",
      [
        {
          componentId: "c1",
          name: "Amsterdam, Netherlands - (AMS)",
          lat: 52.31,
          lon: 4.76,
          source: "iata",
          status: "operational",
          observedAt: "2026-08-27T10:00:00.000Z",
        },
      ],
      { located: 1, total: 12, checkedAt: "2026-08-27T10:00:00.000Z" },
    );
    app.runtime.db.prepare("UPDATE services SET enabled = 0 WHERE id = 'cloudflare'").run();

    const payload = (await app.get("/map")).body as MapBody;
    assert.deepEqual(payload.points, []);
    assert.deepEqual(payload.unlocated, []);
  } finally {
    await app.close();
  }
});

test("a provider with nothing located appears only in unlocated", async () => {
  const app = await api();
  try {
    seed(app.runtime, "github", "GitHub");
    app.runtime.mapStore.replaceProvider("github", [], { located: 0, total: 12, checkedAt: "2026-08-27T10:00:00.000Z" });

    const payload = (await app.get("/map")).body as MapBody;
    assert.deepEqual(payload.points, []);
    assert.deepEqual(payload.unlocated, [{ providerId: "github", providerName: "GitHub", count: 12 }]);
  } finally {
    await app.close();
  }
});
