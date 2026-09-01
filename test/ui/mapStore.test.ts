import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createMapStore } from "../../src/ui/mapStore.ts";

/**
 * Seeds a `:memory:` database with the given service ids so `replaceProvider`'s
 * foreign key has something to reference. Different tests need different
 * providers configured (or none at all), hence the id list rather than a
 * single hardcoded seed.
 */
const NAMES: Record<string, string> = { cloudflare: "Cloudflare", github: "GitHub" };

const db = async (...serviceIds: string[]): Promise<DatabaseSync> => {
  const database = openDatabase(":memory:");
  migrate(database);
  const insertService = database.prepare(
    `INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at)
     VALUES (?, ?, 'statuspage', 'https://x', NULL, 1, '2026-08-27T09:00:00.000Z')`,
  );
  for (const id of serviceIds) {
    insertService.run(id, NAMES[id] ?? id);
  }
  return database;
};

const point = (componentId: string, status = "operational") => ({
  componentId,
  name: `Somewhere - (${componentId.toUpperCase()})`,
  lat: 52.31,
  lon: 4.76,
  source: "iata" as const,
  status: status as "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown",
  observedAt: "2026-08-27T10:00:00.000Z",
});

const state = (located: number, total: number) => ({
  located,
  total,
  checkedAt: "2026-08-27T10:00:00.000Z",
});

test("replaceProvider stores points and geo state", async () => {
  const store = createMapStore(await db("cloudflare"));
  store.replaceProvider("cloudflare", [point("ams"), point("fra")], state(2, 12));

  assert.equal(store.listPoints().length, 2);
  assert.deepEqual(store.listGeoState(), [
    { providerId: "cloudflare", located: 2, total: 12, checkedAt: "2026-08-27T10:00:00.000Z" },
  ]);
});

test("replaceProvider upserts rather than appending", async () => {
  const store = createMapStore(await db("cloudflare"));
  store.replaceProvider("cloudflare", [point("ams")], state(1, 12));
  store.replaceProvider("cloudflare", [point("ams", "major_outage")], state(1, 12));

  const points = store.listPoints();
  assert.equal(points.length, 1, "a second write must not append a row");
  assert.equal(points[0]?.status, "major_outage");
});

test("replaceProvider drops a component the provider stopped listing", async () => {
  const store = createMapStore(await db("cloudflare"));
  store.replaceProvider("cloudflare", [point("ams"), point("fra")], state(2, 12));
  store.replaceProvider("cloudflare", [point("ams")], state(1, 12));

  assert.deepEqual(
    store.listPoints().map((p) => p.componentId),
    ["ams"],
    "a removed PoP must stop being drawn",
  );
});

test("replaceProvider records geo state for a provider with nothing located", async () => {
  // The case the refresh lane depends on: GitHub's components are all
  // functional, so `located` is 0 and `total` is 12 — and that row is exactly
  // what lets the lane skip re-fetching GitHub, and what the card's "N could
  // not be placed" line is built from. A provider with no dots is not a
  // provider with no record.
  const store = createMapStore(await db("github"));
  store.replaceProvider("github", [], state(0, 12));
  assert.deepEqual(store.listGeoState(), [
    { providerId: "github", located: 0, total: 12, checkedAt: "2026-08-27T10:00:00.000Z" },
  ]);
});

test("replaceProvider refuses a provider that is not configured", async () => {
  // The foreign key is live, and the transaction rolls back rather than leaving
  // half a snapshot behind.
  const store = createMapStore(await db("cloudflare"));
  assert.throws(() => store.replaceProvider("ghost", [point("ams")], state(1, 1)));
  assert.deepEqual(store.listPoints(), []);
  assert.deepEqual(store.listGeoState(), []);
});
