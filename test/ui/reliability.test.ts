import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { createReliabilityService } from "../../src/ui/reliability.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";

const NOW = new Date("2026-08-20T18:00:00.000Z");

async function harness(zone = "UTC"): Promise<{
  store: HistoryStore;
  reliability: ReturnType<typeof createReliabilityService>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-reliability-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'statuspage', 'https://x.example', NULL, 1, '2026-01-01T00:00:00.000Z')",
  );
  insert.run("alpha", "Alpha");
  insert.run("beta", "Beta");
  const store = createSqliteStateStore(db, { now: () => NOW });
  return { store, reliability: createReliabilityService(store, { now: () => NOW, timeZone: () => zone }) };
}

/** Writes one incident row directly: the shape under test is the table, not the poller. */
function incident(
  store: HistoryStore,
  providerId: string,
  incidentId: string,
  startedAt: string,
  resolvedAt: string | null,
): Promise<void> {
  return store.applyBackfill(providerId, {
    samples: [],
    incidents: [
      {
        id: incidentId,
        name: `${providerId} ${incidentId}`,
        impact: "major",
        status: resolvedAt === null ? "investigating" : "resolved",
        startedAt,
        updatedAt: resolvedAt ?? startedAt,
        resolvedAt,
      },
    ],
  });
}

test("MTTR averages the resolved incidents and says how many backed it", async () => {
  const { store, reliability } = await harness();
  await incident(store, "alpha", "i1", "2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z");
  await incident(store, "alpha", "i2", "2026-08-19T06:00:00.000Z", "2026-08-19T09:00:00.000Z");
  // Still open: deliberately not measured to now, which would report a provider
  // mid-outage as terrible and then improve it the moment the outage ended.
  await incident(store, "alpha", "i3", "2026-08-20T12:00:00.000Z", null);

  const report = await reliability.getReport(30);
  const alpha = report.providers.find((entry) => entry.providerId === "alpha");
  assert.equal(alpha?.incidents, 3);
  assert.equal(alpha?.resolved, 2);
  assert.equal(alpha?.mttrMinutes, 120, "60 and 180 minutes");
  assert.equal(alpha?.longestOutageMinutes, 180);
  assert.equal(alpha?.downtimeMinutes, 240);
  await store.close();
});

test("MTBF needs two incidents to have anything to be between", async () => {
  const { store, reliability } = await harness();
  await incident(store, "alpha", "i1", "2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z");
  await incident(store, "beta", "b1", "2026-08-18T00:00:00.000Z", "2026-08-18T01:00:00.000Z");
  await incident(store, "beta", "b2", "2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z");

  const report = await reliability.getReport(30);
  const byId = new Map(report.providers.map((entry) => [entry.providerId, entry]));
  assert.equal(byId.get("alpha")?.mtbfMinutes, null, "one incident is not a rate");
  assert.equal(byId.get("beta")?.mtbfMinutes, 24 * 60);
  await store.close();
});

test("a provider with no incidents reports nulls rather than zeroes", async () => {
  const { store, reliability } = await harness();
  const report = await reliability.getReport(30);
  const alpha = report.providers.find((entry) => entry.providerId === "alpha");
  assert.equal(alpha?.incidents, 0);
  assert.equal(alpha?.mttrMinutes, null);
  assert.equal(alpha?.mtbfMinutes, null);
  assert.equal(alpha?.longestOutageMinutes, null, "not a flawless zero-minute outage");
  await store.close();
});

test("the table leads with the provider that cost the most, not the first alphabetically", async () => {
  const { store, reliability } = await harness();
  await incident(store, "alpha", "i1", "2026-08-19T00:00:00.000Z", "2026-08-19T00:10:00.000Z");
  await incident(store, "beta", "b1", "2026-08-19T00:00:00.000Z", "2026-08-19T05:00:00.000Z");
  const report = await reliability.getReport(30);
  assert.equal(report.providers[0]?.providerId, "beta");
  await store.close();
});

test("the previous window is counted separately, so the table can say which way it is going", async () => {
  const { store, reliability } = await harness();
  // Two in the last 7 days, three in the 7 before that.
  await incident(store, "alpha", "n1", "2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z");
  await incident(store, "alpha", "n2", "2026-08-18T00:00:00.000Z", "2026-08-18T01:00:00.000Z");
  await incident(store, "alpha", "p1", "2026-08-10T00:00:00.000Z", "2026-08-10T01:00:00.000Z");
  await incident(store, "alpha", "p2", "2026-08-09T00:00:00.000Z", "2026-08-09T01:00:00.000Z");
  await incident(store, "alpha", "p3", "2026-08-08T00:00:00.000Z", "2026-08-08T01:00:00.000Z");

  const report = await reliability.getReport(7);
  const alpha = report.providers.find((entry) => entry.providerId === "alpha");
  assert.equal(alpha?.incidents, 2);
  assert.equal(alpha?.previousIncidents, 3);
  await store.close();
});

test("the weekday-hour grid counts onsets in the operator's zone, Monday first", async () => {
  // 2026-08-19T22:30Z is a Wednesday evening in UTC and Thursday morning in
  // Auckland: the same incident belongs in two different cells depending on
  // whose calendar is being read, which is the whole point of 10.7 reaching here.
  const utc = await harness("UTC");
  await incident(utc.store, "alpha", "i1", "2026-08-19T22:30:00.000Z", null);
  const inUtc = await utc.reliability.getReport(30);
  assert.equal(inUtc.byWeekdayHour[2]?.[22], 1, "Wednesday 22:00 UTC");
  assert.equal(inUtc.byWeekdayHour.flat().reduce((sum, value) => sum + value, 0), 1);
  await utc.store.close();

  const nz = await harness("Pacific/Auckland");
  await incident(nz.store, "alpha", "i1", "2026-08-19T22:30:00.000Z", null);
  const inNz = await nz.reliability.getReport(30);
  assert.equal(inNz.byWeekdayHour[3]?.[10], 1, "Thursday 10:00 in Auckland");
  await nz.store.close();
});

/** One sample far enough back that the provider has been watched for `daysAgo` days. */
function watchedSince(store: HistoryStore, providerId: string, daysAgo: number): Promise<void> {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return store.applyBackfill(providerId, {
    samples: [{ observedAt: at, overallStatus: "operational", ok: true }],
    incidents: [],
  });
}

test("the 7-day forecast is a Poisson rate over the last 90 days, whatever window is shown", async () => {
  const { store, reliability } = await harness();
  await watchedSince(store, "alpha", 120);
  // Nine incidents in 90 days: a rate of 0.7 a week, so 1 - e^-0.7 ≈ 50%.
  for (let index = 0; index < 9; index += 1) {
    const start = new Date(NOW.getTime() - (5 + index * 9) * 86_400_000).toISOString();
    await incident(store, "alpha", `f${index}`, start, start);
  }
  // Outside the 90 days: ignored by the forecast.
  await incident(store, "alpha", "old", "2026-04-01T00:00:00.000Z", "2026-04-01T01:00:00.000Z");

  const report = await reliability.getReport(7);
  const alpha = report.providers.find((entry) => entry.providerId === "alpha");
  assert.deepEqual(alpha?.forecast, { basisDays: 90, incidents: 9, perWeek: 0.7, probability: 50 });
  await store.close();
});

test("no forecast before 90 days of watching — a short history is not a base rate", async () => {
  const { store, reliability } = await harness();
  await watchedSince(store, "alpha", 30);
  await incident(store, "alpha", "i1", "2026-08-19T00:00:00.000Z", "2026-08-19T01:00:00.000Z");

  const report = await reliability.getReport(30);
  assert.equal(report.providers.find((entry) => entry.providerId === "alpha")?.forecast, null);
  await store.close();
});

test("the forecast never rounds up to a certainty", async () => {
  const { store, reliability } = await harness();
  await watchedSince(store, "alpha", 120);
  for (let index = 0; index < 120; index += 1) {
    const start = new Date(NOW.getTime() - (1 + (index % 85)) * 86_400_000 - index * 60_000).toISOString();
    await incident(store, "alpha", `busy${index}`, start, start);
  }
  const report = await reliability.getReport(30);
  assert.equal(report.providers.find((entry) => entry.providerId === "alpha")?.forecast?.probability, 99);
  await store.close();
});
