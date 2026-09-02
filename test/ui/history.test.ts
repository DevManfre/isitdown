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
import type { OverallStatus } from "../../src/core/types.ts";

const DAY_MS = 24 * 3600 * 1000;
/** Fixed "today" so day bucketing never depends on when the suite runs. */
const NOW = new Date("2026-08-19T12:00:00.000Z");
const daysAgo = (n: number, hour = 12): string =>
  new Date(NOW.getTime() - n * DAY_MS).toISOString().replace("T12:00", `T${String(hour).padStart(2, "0")}:00`);

async function harness(providers: string[] = ["github"]): Promise<{
  store: HistoryStore;
  history: ReturnType<typeof createHistoryService>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-history-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, ?)",
  );
  for (const id of providers) insert.run(id, id, `https://${id}.example`, daysAgo(200));
  const store = createSqliteStateStore(db, { now: () => NOW });
  return { store, history: createHistoryService(store, { now: () => NOW }) };
}

const sample = (store: HistoryStore, provider: string, at: string, status: OverallStatus) =>
  store.saveStatus({ provider, overallStatus: status, activeIncidents: [], components: [], maintenances: [], fetchedAt: at });

test("a week of operational samples is a hundred percent uptime with one bucket per day", async () => {
  const { store, history } = await harness();
  for (let day = 0; day < 7; day += 1) await sample(store, "github", daysAgo(day), "operational");

  const result = await history.getProviderHistory("github", 7, 3);
  assert.equal(result.buckets.length, 7);
  assert.equal(result.uptime7, 100);
  assert.ok(result.buckets.every((bucket) => bucket.status === "operational"));
  assert.equal(result.downtimeMinutes, 0);
  await store.close();
});

test("buckets are ordered oldest first, so a bar row reads left to right", async () => {
  const { store, history } = await harness();
  for (let day = 0; day < 3; day += 1) await sample(store, "github", daysAgo(day), "operational");
  const { buckets } = await history.getProviderHistory("github", 3, 3);
  assert.deepEqual(
    buckets.map((bucket) => bucket.day),
    [daysAgo(2).slice(0, 10), daysAgo(1).slice(0, 10), daysAgo(0).slice(0, 10)],
  );
  await store.close();
});

test("the worst status of a day wins the bucket, not the average", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(1, 1), "operational");
  await sample(store, "github", daysAgo(1, 2), "major_outage");
  await sample(store, "github", daysAgo(1, 3), "operational");
  await sample(store, "github", daysAgo(0), "operational");

  const { buckets } = await history.getProviderHistory("github", 2, 3);
  assert.equal(buckets[0]?.status, "major_outage", "one bad sample must colour the day");
  assert.equal(buckets[1]?.status, "operational");
  await store.close();
});

test("a day with no samples is an unknown bucket in its own position", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(2), "operational");
  await sample(store, "github", daysAgo(0), "operational");

  const { buckets } = await history.getProviderHistory("github", 3, 3);
  assert.deepEqual(
    buckets.map((bucket) => bucket.status),
    ["operational", "unknown", "operational"],
  );
  await store.close();
});

test("a gap does not drag the uptime percentage down", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(6), "operational");
  await sample(store, "github", daysAgo(0), "operational");
  const result = await history.getProviderHistory("github", 7, 3);
  assert.equal(result.uptime7, 100, "uptime is measured over samples taken, not days imagined");
  await store.close();
});

test("a ninety day window always returns ninety buckets", async () => {
  const { store, history } = await harness();
  for (let day = 0; day < 10; day += 1) await sample(store, "github", daysAgo(day), "operational");
  const { buckets } = await history.getProviderHistory("github", 90, 3);
  assert.equal(buckets.length, 90);
  assert.equal(buckets.filter((bucket) => bucket.status === "unknown").length, 80);
  await store.close();
});

test("uptime is reported for seven, thirty and ninety days independently", async () => {
  const { store, history } = await harness();
  // Bad only outside the seven-day window.
  for (let day = 0; day < 40; day += 1) {
    await sample(store, "github", daysAgo(day), day >= 10 && day < 20 ? "major_outage" : "operational");
  }
  const result = await history.getProviderHistory("github", 90, 3);
  assert.equal(result.uptime7, 100);
  assert.ok(result.uptime30 < 100 && result.uptime30 > 50, `got ${result.uptime30}`);
  assert.ok(result.uptime90 < result.uptime7);
  await store.close();
});

test("downtime is the non-operational samples multiplied by the interval", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(1, 1), "major_outage");
  await sample(store, "github", daysAgo(1, 2), "degraded");
  await sample(store, "github", daysAgo(0), "operational");
  const result = await history.getProviderHistory("github", 7, 5);
  assert.equal(result.downtimeMinutes, 10);
  await store.close();
});

test("percentages come back as numbers for the client to format", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0), "operational");
  const result = await history.getProviderHistory("github", 7, 3);
  assert.equal(typeof result.uptime7, "number");
  await store.close();
});

test("the incident count is the incidents that started inside the window", async () => {
  const { store, history } = await harness();
  await store.saveStatus({
    provider: "github",
    overallStatus: "degraded",
    activeIncidents: [
      { id: "recent", name: "x", impact: "minor", status: "investigating", updatedAt: daysAgo(3) },
    ],
    components: [],
    maintenances: [],
    fetchedAt: daysAgo(3),
  });
  await store.saveStatus({
    provider: "github",
    overallStatus: "degraded",
    activeIncidents: [
      { id: "old", name: "y", impact: "minor", status: "investigating", updatedAt: daysAgo(80) },
    ],
    components: [],
    maintenances: [],
    fetchedAt: daysAgo(80),
  });

  assert.equal((await history.getProviderHistory("github", 7, 3)).incidentCount, 1);
  assert.equal((await history.getProviderHistory("github", 90, 3)).incidentCount, 2);
  await store.close();
});

test("a provider with no history at all reports zero rather than throwing", async () => {
  const { store, history } = await harness();
  const result = await history.getProviderHistory("github", 30, 3);
  assert.equal(result.uptime30, 0);
  assert.equal(result.incidentCount, 0);
  assert.equal(result.buckets.length, 30);
  await store.close();
});

test("the summary averages across providers and lists four months", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  for (let day = 0; day < 5; day += 1) {
    await sample(store, "github", daysAgo(day), "operational");
    await sample(store, "cloudflare", daysAgo(day), day === 0 ? "major_outage" : "operational");
  }

  const summary = await history.getSummary(30, 3);
  assert.deepEqual(
    summary.providers.map((provider) => provider.providerId).sort(),
    ["cloudflare", "github"],
  );
  assert.ok(summary.aggregateUptime < 100 && summary.aggregateUptime > 80, `got ${summary.aggregateUptime}`);
  assert.equal(summary.months.length, 4);
  await store.close();
});

test("the summary's months are the last four calendar months, oldest first", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0), "operational");
  const summary = await history.getSummary(90, 3);
  assert.deepEqual(
    summary.months.map((month) => month.month),
    ["2026-05", "2026-06", "2026-07", "2026-08"],
  );
  await store.close();
});

test("a disabled provider still appears in the summary, since its history is real", async () => {
  const { store, history } = await harness(["github"]);
  await sample(store, "github", daysAgo(0), "operational");
  const summary = await history.getSummary(30, 3);
  assert.equal(summary.providers.length, 1);
  await store.close();
});

test("a day mixing an unclassifiable sample with good ones still reads as operational", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(1, 1), "unknown");
  await sample(store, "github", daysAgo(1, 2), "operational");
  await sample(store, "github", daysAgo(0, 1), "unknown");

  const { buckets } = await history.getProviderHistory("github", 2, 3);
  assert.equal(buckets[0]?.status, "operational", "one unknown sample must not mute a good day");
  assert.equal(buckets[1]?.status, "unknown", "a day with nothing but unknowns stays unknown");
  await store.close();
});

test("a provider measured at zero percent drags the aggregate down instead of vanishing from it", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  await sample(store, "github", daysAgo(0), "operational");
  await sample(store, "cloudflare", daysAgo(0), "major_outage");

  const summary = await history.getSummary(30, 3);
  assert.equal(
    summary.aggregateUptime,
    50,
    "a provider that is fully down was measured, so it belongs in the average",
  );
});

test("a provider with no samples at all is excluded from the aggregate rather than counted as zero", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  await sample(store, "github", daysAgo(0), "operational");
  // cloudflare has never been polled.

  const summary = await history.getSummary(30, 3);
  assert.equal(summary.aggregateUptime, 100, "an unmeasured provider must not invent downtime");
  assert.equal(summary.providers.find((p) => p.providerId === "cloudflare")?.sampleCount, 0);
});

test("a provider history reports how many samples backed its percentages", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0, 1), "operational");
  await sample(store, "github", daysAgo(0, 2), "major_outage");
  const result = await history.getProviderHistory("github", 30, 3);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.uptime30, 50);
});

test("a month with no samples reports no uptime rather than zero percent", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0), "operational");
  const summary = await history.getSummary(90, 3);

  const thisMonth = summary.months.at(-1);
  assert.equal(thisMonth?.uptime, 100);
  for (const month of summary.months.slice(0, -1)) {
    assert.equal(month.uptime, null, `${month.month} had no samples, so 0% would be a lie`);
  }
});

test("component histories are gap-filled and windowed like the provider's", async () => {
  const { store } = await harness();
  // "c1" gets a day of 20 component samples, 10 of them operational, one day
  // before the service's fixed "today" of 2026-08-20 — i.e. yesterday.
  for (let hour = 0; hour < 10; hour += 1) {
    await store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [{ id: "c1", name: "Actions", status: "operational" }],
      maintenances: [],
      fetchedAt: daysAgo(0, hour),
    });
  }
  for (let hour = 10; hour < 20; hour += 1) {
    await store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [{ id: "c1", name: "Actions", status: "degraded" }],
      maintenances: [],
      fetchedAt: daysAgo(0, hour),
    });
  }
  // "c2" is never sampled at all.

  const service = createHistoryService(store, { now: () => new Date("2026-08-20T12:00:00.000Z") });
  const histories = await service.getComponentHistories(
    "github",
    [
      { id: "c1", name: "Actions" },
      { id: "c2", name: "Pages" },
    ],
    7,
  );
  assert.equal(histories.length, 2);
  assert.equal(histories[0]?.componentId, "c1");
  assert.equal(histories[0]?.name, "Actions");
  assert.equal(histories[0]?.buckets.length, 7);
  assert.equal(histories[0]?.uptime7, 50);
  assert.equal(histories[0]?.sampleCount, 20);
  // never measured: zero samples and 0% must not be conflated — sampleCount tells them apart
  assert.equal(histories[1]?.sampleCount, 0);
  assert.equal(histories[1]?.buckets.every((bucket) => bucket.status === "unknown"), true);
  await store.close();
});

test("dailySeries carries one entry per day, oldest first, gap-filled with null", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(2), "operational");
  await sample(store, "github", daysAgo(0), "operational");

  const { dailySeries } = await history.getProviderHistory("github", 3, 3);

  assert.deepEqual(
    dailySeries.map((entry) => entry.uptime),
    [100, null, 100],
    "the middle day was never sampled: null, never 0, which would draw a full-day outage",
  );
  assert.deepEqual(
    dailySeries.map((entry) => entry.day),
    [daysAgo(2).slice(0, 10), daysAgo(1).slice(0, 10), daysAgo(0).slice(0, 10)],
  );
  await store.close();
});

test("a day's uptime is its own ok/total ratio, not its worst status", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(1, 1), "operational");
  await sample(store, "github", daysAgo(1, 2), "major_outage");
  await sample(store, "github", daysAgo(1, 3), "operational");
  await sample(store, "github", daysAgo(0), "operational");

  const { dailySeries, buckets } = await history.getProviderHistory("github", 2, 3);

  assert.equal(buckets[0]?.status, "major_outage", "the status bar still shows the worst sample");
  assert.equal(dailySeries[0]?.uptime, 66.67, "two of three samples were ok");
  await store.close();
});

test("previousUptime reads the window immediately before the one requested", async () => {
  const { store, history } = await harness();
  // Requested window: days 0-1. The window before it: days 2-3.
  await sample(store, "github", daysAgo(0), "operational");
  await sample(store, "github", daysAgo(1), "operational");
  await sample(store, "github", daysAgo(2), "major_outage");
  await sample(store, "github", daysAgo(3), "operational");

  const { previousUptime } = await history.getProviderHistory("github", 2, 3);

  assert.equal(previousUptime, 50, "one of the two previous days was down");
  await store.close();
});

test("previousUptime is null when nothing was sampled before the window", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0), "operational");

  const { previousUptime } = await history.getProviderHistory("github", 2, 3);

  assert.equal(previousUptime, null, "a fresh install has not fallen from zero");
  await store.close();
});

test("a 90-day window is compared against the 90 days before it", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(10), "operational");
  await sample(store, "github", daysAgo(120), "major_outage");
  await sample(store, "github", daysAgo(121), "operational");

  const { previousUptime } = await history.getProviderHistory("github", 90, 3);

  assert.equal(previousUptime, 50, "days 90-179 must be read, which needs a 180-day bucket window");
  await store.close();
});

test("fleet daily uptime is the unweighted mean of the providers measured that day", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  // Yesterday: github 1 of 2 samples ok (50), cloudflare 1 of 1 (100).
  await sample(store, "github", daysAgo(1, 1), "operational");
  await sample(store, "github", daysAgo(1, 2), "major_outage");
  await sample(store, "cloudflare", daysAgo(1, 1), "operational");
  // Today: only cloudflare was measured, and it was down.
  await sample(store, "cloudflare", daysAgo(0), "major_outage");

  const { dailyUptime } = await history.getSummary(2, 3);

  assert.equal(dailyUptime[0]?.uptime, 75, "(50 + 100) / 2 — one provider, one vote");
  assert.equal(dailyUptime[1]?.uptime, 0, "a measured 0 is a real outage, and stays 0");
  await store.close();
});

test("a day no provider was measured is null, not zero", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  await sample(store, "github", daysAgo(0), "operational");

  const { dailyUptime } = await history.getSummary(3, 3);

  assert.deepEqual(dailyUptime.map((entry) => entry.uptime), [null, null, 100]);
  await store.close();
});

test("aggregateDelta is the current-vs-previous mean over providers present in both windows", async () => {
  const { store, history } = await harness(["github", "cloudflare"]);
  // Requested window: days 0-1. The window before it: days 2-3.
  await sample(store, "github", daysAgo(0), "operational");
  await sample(store, "github", daysAgo(2), "major_outage");
  await sample(store, "cloudflare", daysAgo(0), "operational");
  await sample(store, "cloudflare", daysAgo(3), "operational");

  const summary = await history.getSummary(2, 3);

  // github: uptime7 50 (1 of 2 samples ok), previousUptime 0 (down on day 2).
  // cloudflare: uptime7 100, previousUptime 100. Both providers are present in
  // both windows, so both count: mean(50, 100) - mean(0, 100) = 75 - 50 = 25.
  assert.equal(summary.aggregateDelta, 25);
  await store.close();
});

test("aggregateDelta compares only providers with samples in both windows, ignoring one with samples only in the current window", async () => {
  const { store, history } = await harness(["github", "newcomer"]);
  // github: sampled in the current window (day 0) and the previous one (day
  // 2) — flat at 100% in both, so it contributes no change.
  await sample(store, "github", daysAgo(0), "operational");
  await sample(store, "github", daysAgo(2), "operational");
  // newcomer: sampled only in the current window, and badly. This is a
  // provider just added to the fleet, not one that fell — it must not be
  // read as a fall.
  await sample(store, "newcomer", daysAgo(0), "major_outage");

  const summary = await history.getSummary(2, 3);

  assert.equal(
    summary.aggregateUptime,
    50,
    "aggregateUptime still averages every provider with current samples, newcomer included",
  );
  assert.equal(
    summary.aggregateDelta,
    0,
    "newcomer has no previous window and must be excluded from the delta entirely — github alone is flat, so the honest delta is zero, not the roughly -50 a naive aggregateUptime-minus-previousAggregate would print",
  );
  await store.close();
});

test("aggregateDelta is null when no provider has both a current and a previous sample", async () => {
  const { store, history } = await harness();
  await sample(store, "github", daysAgo(0), "operational");

  const { aggregateDelta } = await history.getSummary(2, 3);

  assert.equal(aggregateDelta, null, "no comparison exists, so none is claimed");
  await store.close();
});
