import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createMapStore } from "../../src/ui/mapStore.ts";
import { createMapLane, MAP_REFRESH_MS } from "../../src/ui/mapLane.ts";
import { loadGeoTables } from "../../src/ui/geo/resolveLocation.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { Adapter, ComponentPreview } from "../../src/core/adapter.interface.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";

const silent = createLogger("error", () => {});
const tables = loadGeoTables();

const service = (id: string, enabled = true): ServiceDefinition => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: "https://example.com",
  enabled,
  components: [],
  scopeToComponents: false,
});

const preview = (
  id: string,
  name: string,
  status: ComponentPreview["status"] = "operational",
): ComponentPreview => ({
  id,
  name,
  group: null,
  showcase: false,
  status,
});

interface Harness {
  calls: string[];
  lane: ReturnType<typeof createMapLane>;
  store: ReturnType<typeof createMapStore>;
}

function harness(services: ServiceDefinition[], components: Record<string, ComponentPreview[]>): Harness {
  const db = openDatabase(":memory:");
  migrate(db);
  const insertService = db.prepare(
    `INSERT INTO services (id, name, adapter, base_url, enabled, scope_to_components, created_at)
     VALUES (?, ?, 'statuspage', 'https://example.com', ?, 0, '2026-08-27T09:00:00.000Z')`,
  );
  for (const item of services) {
    insertService.run(item.id, item.name, item.enabled ? 1 : 0);
  }

  const calls: string[] = [];
  const adapter: Adapter = {
    id: "statuspage",
    fetchStatus: () => {
      throw new Error("the map lane must never call fetchStatus");
    },
    listComponents: async (ref) => {
      calls.push(ref.id);
      return components[ref.id] ?? [];
    },
  };

  const store = createMapStore(db);
  const lane = createMapLane({
    store,
    tables,
    logger: silent,
    getAdapter: () => adapter,
    listServices: () => services,
    timeoutMs: 1000,
  });
  return { calls, lane, store };
}

test("the lane places components it can resolve and counts the rest", async () => {
  const { lane, store } = harness([service("cloudflare")], {
    cloudflare: [
      preview("c1", "Amsterdam, Netherlands - (AMS)"),
      preview("c2", "Frankfurt, Germany - (FRA)", "major_outage"),
      preview("c3", "Abuse Reports"),
    ],
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));

  const points = store.listPoints();
  assert.equal(points.length, 2);
  assert.equal(points.find((p) => p.componentId === "c2")?.status, "major_outage");
  assert.deepEqual(store.listGeoState(), [
    { providerId: "cloudflare", located: 2, total: 3, checkedAt: "2026-08-27T10:00:00.000Z" },
  ]);
});

test("a provider with nothing located is skipped on the next refresh", async () => {
  const { lane, calls } = harness([service("github")], {
    github: [preview("g1", "Git Operations"), preview("g2", "Webhooks")],
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));
  await lane.refresh(new Date("2026-08-27T10:15:00.000Z"));

  assert.deepEqual(calls, ["github"], "a fleet of functional components must not be re-fetched every cycle");
});

test("a skipped provider is re-checked after 24 hours", async () => {
  const { lane, calls } = harness([service("github")], {
    github: [preview("g1", "Git Operations")],
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));
  await lane.refresh(new Date("2026-08-28T10:01:00.000Z"));

  assert.deepEqual(calls, ["github", "github"], "the skip is a cost optimisation, not a permanent verdict");
});

test("a disabled provider is not fetched at all", async () => {
  const { lane, calls } = harness([service("cloudflare", false)], {
    cloudflare: [preview("c1", "Amsterdam, Netherlands - (AMS)")],
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));
  assert.deepEqual(calls, []);
});

test("one provider's failure leaves the others' snapshots intact", async () => {
  const { store } = harness([service("cloudflare"), service("broken")], {
    cloudflare: [preview("c1", "Amsterdam, Netherlands - (AMS)")],
    // `broken` has no entry here — the failing lane below swaps in a thrower for it.
  });

  const failing = createMapLane({
    store,
    tables,
    logger: silent,
    getAdapter: () => ({
      id: "statuspage",
      fetchStatus: () => {
        throw new Error("unused");
      },
      listComponents: async (ref) => {
        if (ref.id === "broken") throw new Error("HTTP 503");
        return [preview("c1", "Amsterdam, Netherlands - (AMS)")];
      },
    }),
    listServices: () => [service("cloudflare"), service("broken")],
    timeoutMs: 1000,
  });

  await failing.refresh(new Date("2026-08-27T10:00:00.000Z"));
  assert.equal(store.listPoints().length, 1, "cloudflare's snapshot must survive broken's 503");
});

test("an adapter without listComponents is skipped without throwing", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO services (id, name, adapter, base_url, enabled, scope_to_components, created_at)
     VALUES ('scraper', 'Scraper', 'custom', 'https://example.com', 1, 0, '2026-08-27T09:00:00.000Z')`,
  ).run();
  const store = createMapStore(db);
  const lane = createMapLane({
    store,
    tables,
    logger: silent,
    getAdapter: () => ({
      id: "custom",
      fetchStatus: () => {
        throw new Error("unused");
      },
    }),
    listServices: () => [{ ...service("scraper"), adapter: "custom" }],
    timeoutMs: 1000,
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));
  assert.deepEqual(store.listPoints(), []);
});

// Ruling A: `getAdapter` throws for an unregistered adapter id rather than
// returning `undefined` (adapters/index.ts:8). That throw happens inside
// `refreshProvider`, which the per-provider try/catch in `refresh()` already
// wraps — so it must cost exactly the one provider that named the bad adapter.
test("a service naming an unregistered adapter does not stop the rest of the fleet", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const insertService = db.prepare(
    `INSERT INTO services (id, name, adapter, base_url, enabled, scope_to_components, created_at)
     VALUES (?, ?, 'statuspage', 'https://example.com', 1, 0, '2026-08-27T09:00:00.000Z')`,
  );
  insertService.run("ghost-adapter", "ghost-adapter");
  insertService.run("cloudflare", "cloudflare");

  const store = createMapStore(db);
  const realStubAdapter: Adapter = {
    id: "statuspage",
    fetchStatus: () => {
      throw new Error("the map lane must never call fetchStatus");
    },
    listComponents: async () => [preview("c1", "Amsterdam, Netherlands - (AMS)")],
  };
  const lane = createMapLane({
    store,
    tables,
    logger: silent,
    getAdapter: (id) => {
      if (id === "nonesuch") throw new Error(`unknown adapter: ${id}`);
      return realStubAdapter;
    },
    listServices: () => [{ ...service("ghost-adapter"), adapter: "nonesuch" }, service("cloudflare")],
    timeoutMs: 1000,
  });

  await lane.refresh(new Date("2026-08-27T10:00:00.000Z"));
  assert.equal(store.listPoints().length, 1, "cloudflare's markers must survive");
});

// Only `setInterval` is mocked below — `runRefresh`'s own awaits still run on
// real microtasks/macrotasks, so a real `setImmediate` round-trip is what lets
// them settle before an assertion reads `calls`.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("start() fires a refresh only once a full interval has elapsed", async (t) => {
  // Proven by mutation before this test existed: making the interval body a
  // no-op left every other test in this file green, because none of them
  // call start() or stop() at all.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { lane, calls } = harness([service("cloudflare")], {
    cloudflare: [preview("c1", "Amsterdam, Netherlands - (AMS)")],
  });

  lane.start();
  t.mock.timers.tick(MAP_REFRESH_MS - 1);
  await flush();
  assert.deepEqual(calls, [], "must not fire before a full interval has elapsed");

  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(calls, ["cloudflare"]);

  lane.stop();
});

test("stop() prevents any further firing", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { lane, calls } = harness([service("cloudflare")], {
    cloudflare: [preview("c1", "Amsterdam, Netherlands - (AMS)")],
  });

  lane.start();
  t.mock.timers.tick(MAP_REFRESH_MS);
  await flush();
  assert.deepEqual(calls, ["cloudflare"]);

  lane.stop();
  t.mock.timers.tick(MAP_REFRESH_MS * 3);
  await flush();
  assert.deepEqual(calls, ["cloudflare"], "stop() must leave nothing armed");
});

test("a slow refresh is not started a second time while it is still in flight", async (t) => {
  // scheduler.ts:50-52 solves the same overlap problem by chaining a fresh
  // setTimeout after each cycle instead of using setInterval at all. This
  // lane keeps setInterval and guards overlap with a simple in-flight flag
  // instead — see mapLane.ts for why that fits this lane better.
  t.mock.timers.enable({ apis: ["setInterval"] });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const db = openDatabase(":memory:");
  migrate(db);
  db.prepare(
    `INSERT INTO services (id, name, adapter, base_url, enabled, scope_to_components, created_at)
     VALUES ('cloudflare', 'cloudflare', 'statuspage', 'https://example.com', 1, 0, '2026-08-27T09:00:00.000Z')`,
  ).run();
  const store = createMapStore(db);
  const lane = createMapLane({
    store,
    tables,
    logger: silent,
    getAdapter: () => ({
      id: "statuspage",
      fetchStatus: () => {
        throw new Error("unused");
      },
      listComponents: async (ref) => {
        calls.push(ref.id);
        await gate;
        return [preview("c1", "Amsterdam, Netherlands - (AMS)")];
      },
    }),
    listServices: () => [service("cloudflare")],
    timeoutMs: 1000,
  });

  lane.start();
  t.mock.timers.tick(MAP_REFRESH_MS);
  await flush();
  assert.deepEqual(calls, ["cloudflare"], "the first tick starts the one in-flight refresh");

  // A second full interval elapses while the first refresh is still gated on
  // `gate` — without the overlap guard this starts a second, concurrent pass
  // hitting every adapter twice at once.
  t.mock.timers.tick(MAP_REFRESH_MS);
  await flush();
  assert.deepEqual(calls, ["cloudflare"], "an in-flight refresh must not be started a second time");

  release?.();
  await flush();
  lane.stop();
});
