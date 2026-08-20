import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSamples } from "../../src/ui/backfill.ts";
import type { HistoricalIncident } from "../../src/core/types.ts";

const incident = (over: Partial<HistoricalIncident> = {}): HistoricalIncident => ({
  id: "h1",
  name: "API errors",
  impact: "major",
  status: "resolved",
  startedAt: "2026-08-01T00:20:00.000Z",
  resolvedAt: "2026-08-01T00:40:00.000Z",
  updatedAt: "2026-08-01T00:40:00.000Z",
  ...over,
});

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-08-01T01:00:00.000Z";

test("no incidents means every slot is operational, on a grid strictly before `to`", () => {
  const samples = deriveSamples([], null, FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => sample.observedAt),
    [
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:15:00.000Z",
      "2026-08-01T00:30:00.000Z",
      "2026-08-01T00:45:00.000Z",
    ],
  );
  assert.ok(samples.every((sample) => sample.overallStatus === "operational" && sample.ok));
});

test("a resolved incident window marks exactly its slots, mapped from impact", () => {
  const samples = deriveSamples([incident()], null, FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => [sample.observedAt.slice(11, 16), sample.overallStatus, sample.ok]),
    [
      ["00:00", "operational", true],
      ["00:15", "operational", true],
      ["00:30", "partial_outage", false], // major → partial_outage
      ["00:45", "operational", true],     // resolvedAt 00:40 is exclusive
    ],
  );
});

test("each impact maps to its status, unknown impact is at least a degradation", () => {
  const expected = {
    minor: "degraded",
    major: "partial_outage",
    critical: "major_outage",
    "": "degraded",
    weird: "degraded",
  } as const;
  for (const [impact, status] of Object.entries(expected)) {
    const samples = deriveSamples(
      [incident({ impact, startedAt: FROM, resolvedAt: TO })],
      null,
      FROM,
      TO,
      30,
    );
    assert.equal(samples[0]?.overallStatus, status, `impact ${impact}`);
  }
});

test("an open incident extends to the end of the window", () => {
  const samples = deriveSamples(
    [incident({ startedAt: "2026-08-01T00:30:00.000Z", resolvedAt: null })],
    null,
    FROM,
    TO,
    15,
  );
  assert.deepEqual(
    samples.map((sample) => sample.ok),
    [true, true, false, false],
  );
});

test("overlapping incidents: the worst impact wins", () => {
  const samples = deriveSamples(
    [
      incident({ id: "a", impact: "minor", startedAt: FROM, resolvedAt: TO }),
      incident({ id: "b", impact: "critical", startedAt: "2026-08-01T00:30:00.000Z", resolvedAt: TO }),
    ],
    null,
    FROM,
    TO,
    30,
  );
  assert.deepEqual(
    samples.map((sample) => sample.overallStatus),
    ["degraded", "major_outage"],
  );
});

test("coverageStart clips the grid: no samples where the feed proves nothing", () => {
  const samples = deriveSamples([], "2026-08-01T00:30:00.000Z", FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => sample.observedAt.slice(11, 16)),
    ["00:30", "00:45"],
  );
});

test("an incident that started before the window still marks slots inside it", () => {
  const samples = deriveSamples(
    [incident({ startedAt: "2026-07-20T00:00:00.000Z", resolvedAt: "2026-08-01T00:20:00.000Z" })],
    null,
    FROM,
    TO,
    15,
  );
  assert.deepEqual(
    samples.map((sample) => sample.ok),
    [false, false, true, true],
  );
});

test("an empty or inverted window yields no samples", () => {
  assert.deepEqual(deriveSamples([], null, TO, FROM, 15), []);
  assert.deepEqual(deriveSamples([], null, FROM, FROM, 15), []);
});

test("an incident with unparseable dates is ignored rather than poisoning the grid", () => {
  const samples = deriveSamples([incident({ startedAt: "not a date" })], null, FROM, TO, 30);
  assert.ok(samples.every((sample) => sample.ok));
});

// Task 4: Backfill service tests
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { createBackfillService, BACKFILL_DAYS } from "../../src/ui/backfill.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { Adapter } from "../../src/core/adapter.interface.ts";
import type { ConfigSource, ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";

const silent = createLogger("error", () => {});
const NOW = new Date("2026-08-19T12:00:00.000Z");

const serviceDef = (id: string, adapter = "fake"): ServiceDefinition => ({
  id,
  name: id,
  adapter,
  baseUrl: `https://${id}.example`,
  enabled: true,
});

const configSourceFor = (...services: ServiceDefinition[]): ConfigSource => ({
  load: async () => ({
    polling: { intervalMinutes: 60, requestTimeoutSeconds: 2, maxRetries: 1, failureThreshold: 5 },
    locale: "en",
    services,
    channels: [],
  }),
});

const fakeAdapter = (over: Partial<Adapter> = {}): Adapter => ({
  id: "fake",
  fetchStatus: async () => {
    throw new Error("backfill must never poll current status");
  },
  fetchIncidentHistory: async () => ({
    incidents: [
      {
        id: "h1",
        name: "API errors",
        impact: "major",
        status: "resolved",
        startedAt: "2026-08-10T10:00:00.000Z",
        resolvedAt: "2026-08-10T12:30:00.000Z",
        updatedAt: "2026-08-10T12:30:00.000Z",
      },
    ],
    coverageStart: null,
  }),
  ...over,
});

async function storeHarness(ids: string[]): Promise<{ db: DatabaseSync; store: HistoryStore }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-backfill-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'fake', ?, NULL, 1, ?)",
  );
  for (const id of ids) insert.run(id, id, `https://${id}.example`, NOW.toISOString());
  return { db, store: createSqliteStateStore(db) };
}

const sampleCount = (db: DatabaseSync, id: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = ?").get(id) as { n: number }).n;

test("backfillAll fills 90 days of samples and records the incidents, without touching provider_state", async () => {
  const { db, store } = await storeHarness(["svc"]);
  const service = createBackfillService({
    getAdapter: () => fakeAdapter(),
    store,
    configSource: configSourceFor(serviceDef("svc")),
    logger: silent,
    now: () => NOW,
  });
  await service.backfillAll();

  assert.equal(sampleCount(db, "svc"), BACKFILL_DAYS * 24); // hourly grid, exclusive end
  const incident = await store.getIncident("svc", "h1");
  assert.equal(incident?.resolvedAt, "2026-08-10T12:30:00.000Z");
  assert.equal((await store.getState("svc")).last, null);
  await store.close();
});

test("backfillAll is idempotent: a second run adds nothing", async () => {
  const { db, store } = await storeHarness(["svc"]);
  const deps = {
    getAdapter: () => fakeAdapter(),
    store,
    configSource: configSourceFor(serviceDef("svc")),
    logger: silent,
    now: () => NOW,
  };
  await createBackfillService(deps).backfillAll();
  const after = sampleCount(db, "svc");
  await createBackfillService(deps).backfillAll();
  assert.equal(sampleCount(db, "svc"), after);
  await store.close();
});

test("backfill stops at the earliest real sample and never overlaps it", async () => {
  const { db, store } = await storeHarness(["svc"]);
  const realAt = "2026-08-19T11:00:00.000Z";
  await store.saveStatus({
    provider: "svc",
    overallStatus: "operational",
    activeIncidents: [],
    components: [],
    fetchedAt: realAt,
  });
  await createBackfillService({
    getAdapter: () => fakeAdapter(),
    store,
    configSource: configSourceFor(serviceDef("svc")),
    logger: silent,
    now: () => NOW,
  }).backfillAll();
  const [max] = db
    .prepare("SELECT MAX(observed_at) AS m FROM status_samples WHERE provider_id = ? AND observed_at < ?")
    .all("svc", realAt) as { m: string }[];
  assert.ok((max?.m ?? "") < realAt);
  assert.equal(sampleCount(db, "svc"), 1 + BACKFILL_DAYS * 24 - 1, "one real sample plus the grid short of it");
  await store.close();
});

test("an adapter without fetchIncidentHistory is skipped without error", async () => {
  const { db, store } = await storeHarness(["svc"]);
  await createBackfillService({
    getAdapter: () => fakeAdapter({ fetchIncidentHistory: undefined }),
    store,
    configSource: configSourceFor(serviceDef("svc")),
    logger: silent,
    now: () => NOW,
  }).backfillAll();
  assert.equal(sampleCount(db, "svc"), 0);
  await store.close();
});

test("one provider failing does not stop the next", async () => {
  const { db, store } = await storeHarness(["bad", "good"]);
  await createBackfillService({
    getAdapter: () => ({
      ...fakeAdapter(),
      fetchIncidentHistory: async (ref) => {
        if (ref.id === "bad") throw new Error("boom");
        return { incidents: [], coverageStart: null };
      },
    }),
    store,
    configSource: configSourceFor(serviceDef("bad"), serviceDef("good")),
    logger: silent,
    now: () => NOW,
  }).backfillAll();
  assert.equal(sampleCount(db, "bad"), 0);
  assert.equal(sampleCount(db, "good"), BACKFILL_DAYS * 24);
  await store.close();
});

test("backfillOne targets a single provider and ignores unknown ids", async () => {
  const { db, store } = await storeHarness(["svc", "other"]);
  const service = createBackfillService({
    getAdapter: () => fakeAdapter(),
    store,
    configSource: configSourceFor(serviceDef("svc"), serviceDef("other")),
    logger: silent,
    now: () => NOW,
  });
  await service.backfillOne("svc");
  assert.equal(sampleCount(db, "svc"), BACKFILL_DAYS * 24);
  assert.equal(sampleCount(db, "other"), 0);
  await service.backfillOne("nope"); // must not throw
  await store.close();
});
