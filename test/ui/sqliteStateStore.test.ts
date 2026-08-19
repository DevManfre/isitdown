import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { CONTRACT_PROVIDER_IDS, runStateStoreContract } from "../core/stateStore.contract.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";
import type { Incident, NormalizedStatus } from "../../src/core/types.ts";

function seedServices(db: DatabaseSync, ids: readonly string[]): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'statuspage', ?, NULL, 1, ?)",
  );
  for (const id of ids) insert.run(id, id, `https://${id}.example`, "2026-08-19T00:00:00.000Z");
}

async function harness(extraIds: readonly string[] = []): Promise<{
  db: DatabaseSync;
  store: HistoryStore;
  path: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-sqlite-"));
  const path = join(dir, "statuswatch.db");
  const db = openDatabase(path);
  migrate(db);
  seedServices(db, [...CONTRACT_PROVIDER_IDS, ...extraIds]);
  return { db, store: createSqliteStateStore(db), path };
}

const inc = (over: Partial<Incident> = {}): Incident => ({
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:00:00.000Z",
  ...over,
});

const snap = (over: Partial<NormalizedStatus> = {}): NormalizedStatus => ({
  provider: "github",
  overallStatus: "degraded",
  activeIncidents: [inc()],
  fetchedAt: "2026-08-19T14:05:00.000Z",
  ...over,
});

// The same suite the Light edition's file store passes, unchanged.
runStateStoreContract("sqliteStateStore", async () => {
  const { db, store, path } = await harness();
  return {
    store,
    reopen: async () => {
      const reopened = openDatabase(path);
      migrate(reopened);
      return createSqliteStateStore(reopened);
    },
  };
});

test("saveStatus records exactly one sample per call", async () => {
  const { db, store } = await harness();
  await store.saveStatus(snap());
  await store.saveStatus({ ...snap(), fetchedAt: "2026-08-19T14:08:00.000Z" });
  const [count] = db.prepare("SELECT COUNT(*) AS n FROM status_samples").all() as { n: number }[];
  assert.equal(count?.n, 2);
  await store.close();
});

test("a sample is ok only when the provider is operational", async () => {
  const { db, store } = await harness();
  await store.saveStatus(snap({ overallStatus: "operational", activeIncidents: [] }));
  await store.saveStatus({ ...snap({ overallStatus: "major_outage" }), fetchedAt: "2026-08-19T14:08:00.000Z" });
  const rows = db.prepare("SELECT overall_status, ok FROM status_samples ORDER BY id").all() as {
    overall_status: string;
    ok: number;
  }[];
  assert.deepEqual(
    rows.map((row) => [row.overall_status, row.ok]),
    [
      ["operational", 1],
      ["major_outage", 0],
    ],
  );
  await store.close();
});

test("a new incident is recorded with its start time", async () => {
  const { store } = await harness();
  await store.saveStatus(snap());
  const [row] = await store.listIncidents({ providerId: "github" });
  assert.equal(row?.incidentId, "i1");
  assert.equal(row?.startedAt, "2026-08-19T14:00:00.000Z");
  assert.equal(row?.resolvedAt, null);
  await store.close();
});

test("an incident that changes status keeps its start time and updates the rest", async () => {
  const { store } = await harness();
  await store.saveStatus(snap());
  await store.saveStatus({
    ...snap({ activeIncidents: [inc({ status: "monitoring", updatedAt: "2026-08-19T14:30:00.000Z" })] }),
    fetchedAt: "2026-08-19T14:31:00.000Z",
  });

  const rows = await store.listIncidents({ providerId: "github" });
  assert.equal(rows.length, 1, "an update must not create a second incident");
  assert.equal(rows[0]?.status, "monitoring");
  assert.equal(rows[0]?.startedAt, "2026-08-19T14:00:00.000Z");
  assert.equal(rows[0]?.updatedAt, "2026-08-19T14:30:00.000Z");
  await store.close();
});

test("an incident that disappears is resolved once and its resolution time is stable", async () => {
  const { store } = await harness();
  await store.saveStatus(snap());
  await store.saveStatus({
    ...snap({ overallStatus: "operational", activeIncidents: [] }),
    fetchedAt: "2026-08-19T15:00:00.000Z",
  });
  const first = (await store.listIncidents({ providerId: "github" }))[0]?.resolvedAt;
  assert.equal(first, "2026-08-19T15:00:00.000Z");

  await store.saveStatus({
    ...snap({ overallStatus: "operational", activeIncidents: [] }),
    fetchedAt: "2026-08-19T16:00:00.000Z",
  });
  const second = (await store.listIncidents({ providerId: "github" }))[0]?.resolvedAt;
  assert.equal(second, first, "a resolution time must not drift on later cycles");
  await store.close();
});

test("an incident id that becomes active again reopens its row rather than staying closed", async () => {
  const { store } = await harness();
  await store.saveStatus(snap());
  await store.saveStatus({
    ...snap({ overallStatus: "operational", activeIncidents: [] }),
    fetchedAt: "2026-08-19T15:00:00.000Z",
  });
  await store.saveStatus({
    ...snap({ activeIncidents: [inc({ status: "identified", updatedAt: "2026-08-19T16:00:00.000Z" })] }),
    fetchedAt: "2026-08-19T16:01:00.000Z",
  });

  const rows = await store.listIncidents({ providerId: "github" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resolvedAt, null, "a reopened incident is active again");
  assert.equal(rows[0]?.status, "identified");
  await store.close();
});

test("listIncidents can split active from resolved", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ activeIncidents: [inc({ id: "open" }), inc({ id: "closing" })] }));
  await store.saveStatus({
    ...snap({ activeIncidents: [inc({ id: "open" })] }),
    fetchedAt: "2026-08-19T15:00:00.000Z",
  });

  assert.deepEqual(
    (await store.listIncidents({ state: "active" })).map((row) => row.incidentId),
    ["open"],
  );
  assert.deepEqual(
    (await store.listIncidents({ state: "resolved" })).map((row) => row.incidentId),
    ["closing"],
  );
  await store.close();
});

test("listIncidents honours its provider filter and limit", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ provider: "github", activeIncidents: [inc({ id: "a" })] }));
  await store.saveStatus(snap({ provider: "cloudflare", activeIncidents: [inc({ id: "b" })] }));

  assert.deepEqual(
    (await store.listIncidents({ providerId: "cloudflare" })).map((row) => row.incidentId),
    ["b"],
  );
  assert.equal((await store.listIncidents({ limit: 1 })).length, 1);
  await store.close();
});

test("getIncident returns one incident or null", async () => {
  const { store } = await harness();
  await store.saveStatus(snap());
  assert.equal((await store.getIncident("github", "i1"))?.name, "API requests failing");
  assert.equal(await store.getIncident("github", "nope"), null);
  assert.equal(await store.getIncident("nobody", "i1"), null);
  await store.close();
});

test("notifications are recorded and read back newest first", async () => {
  const { store } = await harness();
  await store.recordNotification({
    providerId: "github",
    channel: "telegram",
    kind: "status_change",
    text: "first",
    sentAt: "2026-08-19T14:00:00.000Z",
    ok: true,
  });
  await store.recordNotification({
    providerId: "github",
    channel: "webhook",
    kind: "incident_opened",
    text: "second",
    sentAt: "2026-08-19T14:05:00.000Z",
    ok: false,
    error: "HTTP 500",
  });

  const rows = await store.listNotifications(10);
  assert.deepEqual(
    rows.map((row) => row.text),
    ["second", "first"],
  );
  assert.equal(rows[0]?.ok, false);
  assert.equal(rows[0]?.error, "HTTP 500");
  assert.equal(rows[1]?.error, undefined);
  await store.close();
});

test("listNotifications respects its limit", async () => {
  const { store } = await harness();
  for (let i = 0; i < 5; i += 1) {
    await store.recordNotification({
      providerId: "github",
      channel: "telegram",
      kind: "status_change",
      text: `n${i}`,
      sentAt: `2026-08-19T14:0${i}:00.000Z`,
      ok: true,
    });
  }
  assert.equal((await store.listNotifications(2)).length, 2);
  await store.close();
});

test("getRecentSamples returns the newest samples up to the limit", async () => {
  const { store } = await harness();
  for (let minute = 0; minute < 5; minute += 1) {
    await store.saveStatus({ ...snap(), fetchedAt: `2026-08-19T14:0${minute}:00.000Z` });
  }
  const samples = await store.getRecentSamples("github", 3);
  assert.deepEqual(
    samples.map((sample) => sample.observedAt),
    ["2026-08-19T14:04:00.000Z", "2026-08-19T14:03:00.000Z", "2026-08-19T14:02:00.000Z"],
  );
  assert.equal(samples[0]?.ok, false);
  await store.close();
});

test("pruneOlderThan drops old samples and keeps recent ones", async () => {
  const { db, store } = await harness();
  const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  await store.saveStatus({ ...snap(), fetchedAt: old });
  await store.saveStatus({ ...snap(), fetchedAt: recent });

  await store.pruneOlderThan(120);

  const rows = db.prepare("SELECT observed_at FROM status_samples").all() as { observed_at: string }[];
  assert.deepEqual(
    rows.map((row) => row.observed_at),
    [recent],
  );
  await store.close();
});

test("a failed cycle writes no sample, so our own outage is not the provider's downtime", async () => {
  const { db, store } = await harness();
  await store.saveStatus(snap());
  await store.recordFailure("github");
  await store.recordFailure("github");
  const [count] = db.prepare("SELECT COUNT(*) AS n FROM status_samples").all() as { n: number }[];
  assert.equal(count?.n, 1);
  await store.close();
});

test("state for one provider is untouched by another provider's save", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ provider: "github", overallStatus: "major_outage" }));
  await store.saveStatus(snap({ provider: "cloudflare", overallStatus: "operational", activeIncidents: [] }));
  assert.equal((await store.getState("github")).last?.overallStatus, "major_outage");
  assert.equal((await store.getState("cloudflare")).last?.overallStatus, "operational");
  await store.close();
});
