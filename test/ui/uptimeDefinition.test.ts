import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { createHistoryService } from "../../src/ui/history.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";
import type { MaintenanceWindow, OverallStatus } from "../../src/core/types.ts";

/**
 * The published definition of uptime — roadmap 10.2.
 *
 * Every row here is a line of the table in `docs/how-it-works.md` §7.6. The
 * point is not extra coverage of `history.ts`, which its own suite has: it is
 * that the sentence an operator reads and the arithmetic the dashboard does
 * cannot drift apart without a test going red. Change one, and this file makes
 * you change the other.
 */

const NOW = new Date("2026-08-20T18:00:00.000Z");
const DAY_MS = 24 * 3600 * 1000;

async function harness(): Promise<{ store: HistoryStore; history: ReturnType<typeof createHistoryService> }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-uptime-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES ('p', 'P', 'statuspage', 'https://p.example', NULL, 1, '2026-01-01T00:00:00.000Z')",
  ).run();
  const store = createSqliteStateStore(db, { now: () => NOW });
  // UTC, so a row of this table reads as the arithmetic and not as a zone.
  return { store, history: createHistoryService(store, { now: () => NOW, timeZone: () => "UTC" }) };
}

const at = (daysAgo: number, minute: number): string =>
  new Date(NOW.getTime() - daysAgo * DAY_MS - minute * 60_000).toISOString();

const record = (
  store: HistoryStore,
  status: OverallStatus,
  when: string,
  maintenances: MaintenanceWindow[] = [],
) =>
  store.saveStatus({
    provider: "p",
    overallStatus: status,
    activeIncidents: [],
    components: [],
    maintenances,
    fetchedAt: when,
  });

/** The 7-day figure, which is the one every row below is stated against. */
const uptime7 = async (history: ReturnType<typeof createHistoryService>): Promise<number> =>
  (await history.getProviderHistory("p", 7, 3)).uptime7;

test("uptime is the share of readings that were operational", async () => {
  const { store, history } = await harness();
  await record(store, "operational", at(0, 10));
  await record(store, "operational", at(0, 20));
  await record(store, "major_outage", at(0, 30));
  await record(store, "operational", at(0, 40));
  assert.equal(await uptime7(history), 75);
  await store.close();
});

test("degraded and partial outage count as down, with no half credit", async () => {
  for (const status of ["degraded", "partial_outage", "major_outage"] as const) {
    const { store, history } = await harness();
    await record(store, "operational", at(0, 10));
    await record(store, status, at(0, 20));
    assert.equal(await uptime7(history), 50, status);
    await store.close();
  }
});

test("a reading taken during a declared maintenance window counts like any other", async () => {
  const window_: MaintenanceWindow = {
    id: "m1",
    name: "Planned upgrade",
    status: "in_progress",
    startsAt: at(0, 60),
    endsAt: at(0, 0),
    componentIds: [],
  };
  const { store, history } = await harness();
  await record(store, "operational", at(0, 40), [window_]);
  await record(store, "major_outage", at(0, 30), [window_]);
  // Maintenance silences notifications; it does not rewrite the reading.
  assert.equal(await uptime7(history), 50);
  await store.close();
});

test("an unknown reading is not operational, so it lands in the denominator", async () => {
  const { store, history } = await harness();
  await record(store, "operational", at(0, 10));
  await record(store, "unknown", at(0, 20));
  assert.equal(await uptime7(history), 50);
  await store.close();
});

test("a failed fetch writes no sample, so it cannot lower anything", async () => {
  const { store, history } = await harness();
  await record(store, "operational", at(0, 10));
  await store.recordFailure("p");
  await store.recordFailure("p");
  assert.equal(await uptime7(history), 100);
  assert.equal((await history.getProviderHistory("p", 7, 3)).sampleCount, 1);
  await store.close();
});

test("a day with no samples is left out of both sides of the fraction", async () => {
  const { store, history } = await harness();
  // One perfect day six days ago, one perfect day today, five days of nothing.
  await record(store, "operational", at(6, 10));
  await record(store, "operational", at(0, 10));
  assert.equal(await uptime7(history), 100, "the empty days are not zeroes");
  const report = await history.getProviderHistory("p", 7, 3);
  assert.equal(report.buckets.length, 7, "they are still drawn");
  assert.equal(report.dailySeries.filter((entry) => entry.uptime === null).length, 5);
  await store.close();
});

test("readings are weighted equally, not days", async () => {
  const { store, history } = await harness();
  // Yesterday: three readings, all down. Today: one reading, up.
  await record(store, "major_outage", at(1, 10));
  await record(store, "major_outage", at(1, 20));
  await record(store, "major_outage", at(1, 30));
  await record(store, "operational", at(0, 10));
  // One reading in four, not one day in two.
  assert.equal(await uptime7(history), 25);
  await store.close();
});

test("a window with no samples reads 0% beside a sample count of zero, and no delta", async () => {
  const { store, history } = await harness();
  const report = await history.getProviderHistory("p", 7, 3);
  assert.equal(report.uptime7, 0);
  assert.equal(report.sampleCount, 0, "which is how the view says never measured");
  assert.equal(report.previousUptime, null, "rather than a 92-point fall");
  await store.close();
});

test("the fleet figure is one provider one vote, not one reading one vote", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-uptime-fleet-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'statuspage', 'https://x.example', NULL, 1, '2026-01-01T00:00:00.000Z')",
  );
  insert.run("busy", "Busy");
  insert.run("quiet", "Quiet");
  const store = createSqliteStateStore(db, { now: () => NOW });
  const history = createHistoryService(store, { now: () => NOW, timeZone: () => "UTC" });

  const save = (provider: string, status: OverallStatus, when: string) =>
    store.saveStatus({
      provider,
      overallStatus: status,
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: when,
    });

  // Nine good readings from one provider, one bad reading from the other.
  for (let index = 0; index < 9; index += 1) await save("busy", "operational", at(0, 10 + index));
  await save("quiet", "major_outage", at(0, 10));

  const summary = await history.getSummary(7, 3);
  // Readings would give 90%. Providers give 50%.
  assert.equal(summary.aggregateUptime, 50);
  await store.close();
});
