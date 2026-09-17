import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { createHistoryService } from "../../src/ui/history.ts";
import { createSlaService, elapsedMinutes, monthMinutes, rememberSlaNotice, slaAlreadyTold } from "../../src/ui/sla.ts";
import { slaBurn } from "../../src/core/diffEngine.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";
import type { OverallStatus } from "../../src/core/types.ts";

/**
 * Per-provider SLA target and error budget — roadmap 4.13.
 *
 * Two halves, tested apart because they fail differently: the arithmetic (what
 * a month has spent) and the decision (whether that is worth saying).
 */

/**
 * The 10th of a 31-day month, at noon: a third of the way in, far enough that a
 * projection means something and not so far that "the rest of the month" is
 * rounding error.
 */
const NOW = new Date("2026-08-10T12:00:00.000Z");
/** A cadence of exactly a minute makes "samples" and "minutes" the same number. */
const CADENCE = 1;

const at = (day: number, hour = 12): string =>
  new Date(Date.UTC(2026, 7, day, hour, 0, 0)).toISOString();

async function harness(): Promise<{
  store: HistoryStore;
  sla: ReturnType<typeof createSlaService>;
  db: ReturnType<typeof openDatabase>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-sla-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES ('github', 'GitHub', 'statuspage', 'https://gh.example', NULL, 1, ?)",
  ).run(at(1));
  const store = createSqliteStateStore(db, { now: () => NOW });
  const history = createHistoryService(store, { now: () => NOW });
  return { store, db, sla: createSlaService({ history, now: () => NOW }) };
}

const service = (over: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id: "github",
  name: "GitHub",
  adapter: "statuspage",
  baseUrl: "https://gh.example",
  enabled: true,
  components: [],
  scopeToComponents: false,
  ...over,
});

const sample = (store: HistoryStore, when: string, status: OverallStatus) =>
  store.saveStatus({
    provider: "github",
    overallStatus: status,
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: when,
  });

/** `count` readings of `status`, one per hour, ending on day `day`. */
async function samples(store: HistoryStore, day: number, count: number, status: OverallStatus): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await sample(store, new Date(Date.UTC(2026, 7, day, 0, index, 0)).toISOString(), status);
  }
}

test("a month's length and how much of it has gone are read off the calendar", () => {
  // August has 31 days; the 10th at noon is nine and a half days in.
  assert.equal(monthMinutes(NOW), 31 * 24 * 60);
  assert.equal(elapsedMinutes(NOW), 9.5 * 24 * 60);
  // February 2028 is a leap February, and a month is not "30 days".
  assert.equal(monthMinutes(new Date("2028-02-05T00:00:00.000Z")), 29 * 24 * 60);
});

test("a provider with no target is not in the answer at all", async () => {
  const { store, sla } = await harness();
  await samples(store, 5, 60, "operational");
  assert.deepEqual(await sla.budgets([service()], CADENCE), []);
  await store.close();
});

test("a perfect month has spent none of its budget", async () => {
  const { store, sla } = await harness();
  await samples(store, 5, 600, "operational");

  const [budget] = await sla.budgets([service({ slaTarget: 99.9 })], CADENCE);
  assert.equal(budget?.target, 99.9);
  assert.equal(budget?.uptime, 100);
  assert.equal(budget?.spentMinutes, 0);
  // 0.1% of a 31-day month.
  assert.equal(budget?.budgetMinutes, 44.6);
  assert.equal(budget?.remainingMinutes, 44.6);
  assert.equal(budget?.burnRate, 0);
  assert.equal(budget?.willMiss, false);
  await store.close();
});

test("downtime is charged against the budget, and the rate says whether the month can afford it", async () => {
  const { store, sla } = await harness();
  // 1000 readings a minute apart: 900 up, 100 down — 90% uptime, which against
  // a 99.9% target is a month that is already lost.
  await samples(store, 5, 900, "operational");
  await samples(store, 6, 100, "major_outage");

  const [budget] = await sla.budgets([service({ slaTarget: 99.9 })], CADENCE);
  assert.equal(budget?.uptime, 90);
  assert.equal(budget?.spentMinutes, 100);
  assert.equal(budget?.remainingMinutes, 0, "a budget cannot go negative — it is spent");
  // Nine and a half days elapsed allow 13.7 minutes at 99.9%; 100 spent is
  // about seven times that.
  assert.ok((budget?.burnRate ?? 0) > 7, `expected a burn rate above 7, got ${budget?.burnRate}`);
  assert.equal(budget?.willMiss, true);
  await store.close();
});

test("a month nothing measured reports no uptime rather than zero percent", async () => {
  const { store, sla } = await harness();
  const [budget] = await sla.budgets([service({ slaTarget: 99.9 })], CADENCE);
  assert.equal(budget?.uptime, null);
  assert.equal(budget?.projectedUptime, null);
  assert.equal(budget?.burnRate, null);
  // 0% uptime and "never polled" are different statements, and only one of them
  // is an accusation about a vendor.
  assert.equal(budget?.willMiss, false);
  await store.close();
});

test("the burn alert fires once the rate says the month will miss", () => {
  const change = slaBurn({
    providerId: "github",
    month: "2026-08",
    target: 99.9,
    uptime: 90,
    monthMinutes: 31 * 24 * 60,
    measuredMinutes: 1000,
    at: NOW.toISOString(),
  });
  assert.equal(change?.kind, "sla_burn");
  assert.equal(change?.providerId, "github");
  assert.equal(change?.sla?.projectedUptime, 90);
  assert.equal(change?.sla?.month, "2026-08");
  // Not a severity the provider is in — it may well be operational right now.
  assert.equal(change?.currentStatus, "degraded");
});

test("a month that is on track says nothing", () => {
  assert.equal(
    slaBurn({
      providerId: "github",
      month: "2026-08",
      target: 99.9,
      uptime: 99.95,
      monthMinutes: 31 * 24 * 60,
      measuredMinutes: 1000,
      at: NOW.toISOString(),
    }),
    null,
  );
});

test("a handful of samples is not enough to accuse a month", () => {
  // Half an hour in, one bad reading out of five, and the projection says the
  // month is lost. It is not: it says the first half hour was.
  assert.equal(
    slaBurn({
      providerId: "github",
      month: "2026-08",
      target: 99.9,
      uptime: 80,
      monthMinutes: 31 * 24 * 60,
      measuredMinutes: 30,
      at: NOW.toISOString(),
    }),
    null,
  );
});

test("a target outside the range of a target is refused rather than computed", () => {
  for (const target of [0, -1, 101]) {
    assert.equal(
      slaBurn({
        providerId: "github",
        month: "2026-08",
        target,
        uptime: 10,
        monthMinutes: 31 * 24 * 60,
        measuredMinutes: 10_000,
        at: NOW.toISOString(),
      }),
      null,
      String(target),
    );
  }
});

test("a provider is told about once per month, and the next month is its own alert", async () => {
  const { store, db, sla } = await harness();
  await samples(store, 5, 900, "operational");
  await samples(store, 6, 100, "major_outage");
  const services = [service({ slaTarget: 99.9 })];

  const first = await sla.burnChanges(services, CADENCE, (id, month) => slaAlreadyTold(db, id, month));
  assert.equal(first.length, 1);
  rememberSlaNotice(db, "github", first[0]?.sla?.month ?? "");

  const second = await sla.burnChanges(services, CADENCE, (id, month) => slaAlreadyTold(db, id, month));
  assert.deepEqual(second, [], "the same month must not be reported twice");

  // The marker is per month, so September starts clean.
  assert.equal(slaAlreadyTold(db, "github", "2026-09"), false);
  await store.close();
});

test("the marker survives a restart, because a month is longer than an uptime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-sla-restart-"));
  const path = join(dir, "isitdown.db");
  const first = openDatabase(path);
  migrate(first);
  first
    .prepare(
      "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES ('github', 'GitHub', 'statuspage', 'https://gh.example', NULL, 1, ?)",
    )
    .run(at(1));
  rememberSlaNotice(first, "github", "2026-08");
  first.close();

  const second = openDatabase(path);
  migrate(second);
  assert.equal(slaAlreadyTold(second, "github", "2026-08"), true);
  second.close();
});

test("a removed provider takes its notices with it, like its samples", async () => {
  const { store, db } = await harness();
  rememberSlaNotice(db, "github", "2026-08");
  db.prepare("DELETE FROM services WHERE id = 'github'").run();
  assert.equal(slaAlreadyTold(db, "github", "2026-08"), false);
  await store.close();
});
