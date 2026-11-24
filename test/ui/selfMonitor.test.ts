import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { exportConfigYaml, importConfigYaml } from "../../src/ui/configFile.ts";
import {
  LOW_DISK_BYTES,
  selfFindings,
  type SelfComponent,
  type SelfSignals,
} from "../../src/ui/selfMonitor.ts";
import { SELF_MONITOR_ID } from "../../src/ui/selfMonitorId.ts";

/**
 * IsItDown watching IsItDown — roadmap 10.6. The rules as a table, the same
 * shape as the diff engine's, then the row they feed: seeded once, polled like
 * any provider, and its changes handed to the diff engine like any other.
 */

const silent = createLogger("error", () => {});

const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const BOOTED = NOW - 3_600_000;
const minutesAgo = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
/** A cycle that started `startedAgo` minutes ago and ran for `ranFor`, on a five-minute cadence. */
const cycle = (startedAgo: number, ranFor = 0.5) => ({
  startedAt: minutesAgo(startedAgo),
  finishedAt: minutesAgo(startedAgo - ranFor),
  intervalMinutes: 5,
});

const healthy: SelfSignals = {
  now: NOW,
  bootedAt: BOOTED,
  cycles: [cycle(5), cycle(10), cycle(15)],
  providers: [
    { id: "github", failureCount: 0 },
    { id: "cloudflare", failureCount: 2 },
  ],
  failureThreshold: 5,
  failedDeliveries: 0,
  freeBytes: 10 * LOW_DISK_BYTES,
};

const cases: { name: string; signals: Partial<SelfSignals>; degraded: SelfComponent[] }[] = [
  { name: "a healthy instance", signals: {}, degraded: [] },
  {
    name: "no cycle for over twice the interval",
    signals: { cycles: [cycle(11), cycle(16), cycle(21)] },
    degraded: ["polling"],
  },
  {
    name: "exactly twice the interval is still on time",
    signals: { cycles: [cycle(10), cycle(15), cycle(20)] },
    degraded: [],
  },
  {
    name: "a gap from before this process started is a restart, not a slip",
    signals: { bootedAt: NOW - 60_000, cycles: [cycle(90), cycle(95), cycle(100)] },
    degraded: [],
  },
  {
    name: "three cycles in a row over half their interval",
    signals: { cycles: [cycle(5, 3), cycle(10, 3), cycle(15, 3)] },
    degraded: ["polling"],
  },
  {
    name: "two slow cycles out of three is a blip",
    signals: { cycles: [cycle(5, 3), cycle(10, 3), cycle(15)] },
    degraded: [],
  },
  {
    name: "fewer than three cycles cannot be a run",
    signals: { cycles: [cycle(5, 3), cycle(10, 3)] },
    degraded: [],
  },
  { name: "no cycle yet at all", signals: { cycles: [] }, degraded: [] },
  {
    name: "a provider failing as often as the threshold",
    signals: { providers: [{ id: "github", failureCount: 5 }] },
    degraded: ["adapters"],
  },
  {
    name: "a provider failing one short of the threshold",
    signals: { providers: [{ id: "github", failureCount: 4 }] },
    degraded: [],
  },
  { name: "a notification lost in the last day", signals: { failedDeliveries: 1 }, degraded: ["notifications"] },
  { name: "the disk under the database nearly full", signals: { freeBytes: LOW_DISK_BYTES - 1 }, degraded: ["database"] },
  { name: "no file to measure", signals: { freeBytes: null }, degraded: [] },
  {
    name: "everything at once",
    signals: {
      cycles: [cycle(30, 4), cycle(35, 4), cycle(40, 4)],
      providers: [{ id: "github", failureCount: 9 }],
      failedDeliveries: 3,
      freeBytes: 0,
    },
    degraded: ["polling", "adapters", "notifications", "database"],
  },
];

for (const c of cases) {
  test(`self monitor rules: ${c.name}`, () => {
    const findings = selfFindings({ ...healthy, ...c.signals });
    assert.deepEqual([...new Set(findings.map((finding) => finding.component))], c.degraded);
    for (const finding of findings) assert.notEqual(finding.note, "", "every finding says why");
  });
}

async function runtime(): Promise<{ runtime: UiRuntime; dbPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-self-"));
  const dbPath = join(dir, "isitdown.db");
  return { runtime: await buildUiRuntime({ dbPath, env: {}, logger: silent, seedSelfMonitor: true }), dbPath };
}

test("every installation gets the instance's row once, and a removed one stays removed", async () => {
  const { runtime: first, dbPath } = await runtime();
  const row = first.listAllServices().find((service) => service.id === SELF_MONITOR_ID);
  assert.equal(row?.adapter, SELF_MONITOR_ID);
  assert.deepEqual(
    row?.components?.map((component) => component.id),
    ["polling", "adapters", "notifications", "database"],
  );
  first.db.prepare("DELETE FROM services WHERE id = ?").run(SELF_MONITOR_ID);
  await first.close();

  const second = await buildUiRuntime({ dbPath, env: {}, logger: silent, seedSelfMonitor: true });
  try {
    assert.equal(second.listAllServices().some((service) => service.id === SELF_MONITOR_ID), false);
  } finally {
    await second.close();
  }
});

test("a lost notification degrades the instance through the ordinary cycle", async () => {
  const { runtime: app } = await runtime();
  try {
    const first = await app.scheduler.triggerFor(SELF_MONITOR_ID);
    const reading = first.results.find((result) => result.providerId === SELF_MONITOR_ID)?.status;
    assert.equal(reading?.overallStatus, "operational");
    assert.deepEqual(
      reading?.components.map((component) => [component.id, component.status]),
      [
        ["polling", "operational"],
        ["adapters", "operational"],
        ["notifications", "operational"],
        ["database", "operational"],
      ],
    );

    app.db
      .prepare(
        "INSERT INTO notifications (provider_id, channel, kind, text, sent_at, ok, error, attempts) VALUES ('github', 'telegram', 'status_change', 'x', ?, 0, 'HTTP 401', 3)",
      )
      .run(new Date().toISOString());

    const second = await app.scheduler.triggerFor(SELF_MONITOR_ID);
    const degraded = second.results.find((result) => result.providerId === SELF_MONITOR_ID)?.status;
    assert.equal(degraded?.overallStatus, "degraded");
    assert.equal(degraded?.components.find((component) => component.id === "notifications")?.status, "degraded");
    assert.ok(
      second.changes.some((change) => change.providerId === SELF_MONITOR_ID),
      "the change went to the diff engine like any provider's",
    );
  } finally {
    await app.close();
  }
});

test("the instance's row never leaves in a config.yml, and importing one leaves it alone", async () => {
  const { runtime: app } = await runtime();
  try {
    const yaml = exportConfigYaml(app.db, silent);
    assert.equal(yaml.includes("self.invalid"), false);
    assert.equal(yaml.includes(`adapter: ${SELF_MONITOR_ID}`), false);

    const report = importConfigYaml(app.db, yaml, silent);
    assert.equal(report.removed.includes(SELF_MONITOR_ID), false);
    assert.ok(app.listAllServices().some((service) => service.id === SELF_MONITOR_ID));
  } finally {
    await app.close();
  }
});
