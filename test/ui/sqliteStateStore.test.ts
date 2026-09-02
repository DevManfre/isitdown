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
import {
  STATUS_CHANGE_KINDS,
  type HistoricalIncident,
  type Incident,
  type MaintenanceWindow,
  type NormalizedStatus,
} from "../../src/core/types.ts";

/** Fixed "today" so a day or retention window never depends on when the suite runs. */
const NOW = new Date("2026-08-20T18:00:00.000Z");

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
  const dir = await mkdtemp(join(tmpdir(), "isitdown-sqlite-"));
  const path = join(dir, "isitdown.db");
  const db = openDatabase(path);
  migrate(db);
  seedServices(db, [...CONTRACT_PROVIDER_IDS, ...extraIds]);
  return { db, store: createSqliteStateStore(db, { now: () => NOW }), path };
}

const mw = (over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  id: "m1",
  name: "Database maintenance",
  status: "scheduled",
  startsAt: "2026-08-20T02:00:00.000Z",
  endsAt: "2026-08-20T04:00:00.000Z",
  componentIds: ["c1"],
  ...over,
});

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
  components: [],
  maintenances: [],
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

test("reads back a maintenance notification, kind and all", async () => {
  // The row schema's `kind` enum has to hold every StatusChangeKind the diff
  // engine can raise; a missing one fails validation on read, which takes down
  // every view that lists notifications, not just the maintenance row.
  const { store } = await harness();
  for (const kind of ["maintenance_started", "maintenance_ended"] as const) {
    await store.recordNotification({
      providerId: "github",
      channel: "telegram",
      kind,
      text: kind,
      sentAt: "2026-08-19T14:00:00.000Z",
      ok: true,
    });
  }

  const rows = await store.listNotifications(10);
  assert.deepEqual(
    rows.map((row) => row.kind).sort(),
    ["maintenance_ended", "maintenance_started"],
  );
  await store.close();
});

test("every StatusChangeKind the diff engine can raise round-trips through the store", async () => {
  // The read-side `kind` enum used to be hand-mirrored from StatusChangeKind,
  // which is exactly the mechanism that took down every notification-listing
  // view mid-branch when it fell one kind behind. Driving this test off the
  // same STATUS_CHANGE_KINDS tuple the store's schema is now built from means
  // a ninth kind added to core fails this test immediately rather than only
  // at runtime, on whichever kind happened to be missing.
  const { store } = await harness();
  let index = 0;
  for (const kind of STATUS_CHANGE_KINDS) {
    await store.recordNotification({
      providerId: "github",
      channel: "telegram",
      kind,
      text: kind,
      sentAt: `2026-08-19T14:${String(index).padStart(2, "0")}:00.000Z`,
      ok: true,
    });
    index += 1;
  }

  const rows = await store.listNotifications(STATUS_CHANGE_KINDS.length);
  assert.deepEqual(
    rows.map((row) => row.kind).sort(),
    [...STATUS_CHANGE_KINDS].sort(),
  );
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

test("a provider timestamp ahead of our clock cannot start an incident in the future", async () => {
  const { store } = await harness();
  // Nothing stops a provider reporting updated_at in the future; if that became
  // started_at, the incident would later resolve "before" it opened and every
  // duration derived from it would be negative.
  await store.saveStatus({
    provider: "github",
    overallStatus: "major_outage",
    activeIncidents: [inc({ updatedAt: "2099-01-01T00:00:00.000Z" })],
    components: [],
    maintenances: [],
    fetchedAt: "2026-08-19T14:05:00.000Z",
  });

  const [row] = await store.listIncidents({ providerId: "github" });
  assert.equal(row?.startedAt, "2026-08-19T14:05:00.000Z", "pinned to when we first saw it");
  assert.equal(row?.updatedAt, "2099-01-01T00:00:00.000Z", "the provider's own claim is still recorded");

  await store.saveStatus({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [],
    maintenances: [],
    fetchedAt: "2026-08-19T15:00:00.000Z",
  });
  const [resolved] = await store.listIncidents({ providerId: "github" });
  assert.ok(
    Date.parse(resolved?.resolvedAt ?? "") >= Date.parse(resolved?.startedAt ?? ""),
    "an incident must never resolve before it started",
  );
  await store.close();
});

test("a normal past provider timestamp is kept as the start time", async () => {
  const { store } = await harness();
  await store.saveStatus({
    provider: "github",
    overallStatus: "degraded",
    activeIncidents: [inc({ updatedAt: "2026-08-19T13:30:00.000Z" })],
    components: [],
    maintenances: [],
    fetchedAt: "2026-08-19T14:05:00.000Z",
  });
  const [row] = await store.listIncidents({ providerId: "github" });
  assert.equal(row?.startedAt, "2026-08-19T13:30:00.000Z", "the provider knows when it began");
  await store.close();
});

const histIncident = (over: Partial<HistoricalIncident> = {}): HistoricalIncident => ({
  id: "h1",
  name: "API errors",
  impact: "major",
  status: "resolved",
  startedAt: "2026-08-10T10:00:00.000Z",
  resolvedAt: "2026-08-10T12:30:00.000Z",
  updatedAt: "2026-08-10T12:30:00.000Z",
  ...over,
});

test("getEarliestSampleTime is null with no samples and MIN(observed_at) with some", async () => {
  const { store } = await harness();
  assert.equal(await store.getEarliestSampleTime("github"), null);
  await store.saveStatus(snap({ fetchedAt: "2026-08-19T14:05:00.000Z" }));
  await store.saveStatus(snap({ fetchedAt: "2026-08-18T14:05:00.000Z" }));
  assert.equal(await store.getEarliestSampleTime("github"), "2026-08-18T14:05:00.000Z");
  await store.close();
});

test("applyBackfill writes samples and historical incidents, never touches provider_state", async () => {
  const { db, store } = await harness();
  await store.applyBackfill("github", {
    samples: [
      { observedAt: "2026-08-10T10:00:00.000Z", overallStatus: "operational", ok: true },
      { observedAt: "2026-08-10T11:00:00.000Z", overallStatus: "partial_outage", ok: false },
    ],
    incidents: [histIncident()],
  });

  const rows = db.prepare("SELECT overall_status, ok FROM status_samples ORDER BY observed_at").all() as {
    overall_status: string;
    ok: number;
  }[];
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { overall_status: "operational", ok: 1 },
    { overall_status: "partial_outage", ok: 0 },
  ]);
  const incident = await store.getIncident("github", "h1");
  assert.equal(incident?.startedAt, "2026-08-10T10:00:00.000Z");
  assert.equal(incident?.resolvedAt, "2026-08-10T12:30:00.000Z");
  const state = await store.getState("github");
  assert.equal(state.last, null, "backfill must not create poll baseline");
  await store.close();
});

test("applyBackfill never overwrites incident row live path owns", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ activeIncidents: [inc({ id: "h1", status: "investigating" })] }));
  await store.applyBackfill("github", {
    samples: [],
    incidents: [histIncident({ id: "h1", status: "resolved" })],
  });
  const incident = await store.getIncident("github", "h1");
  assert.equal(incident?.status, "investigating", "the live row must win");
  assert.equal(incident?.resolvedAt, null);
  await store.close();
});

test("saveStatus persists component state and appends component samples", async () => {
  const { store } = await harness();
  await store.saveStatus({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [
      { id: "c1", name: "Actions", status: "degraded" },
      { id: "c2", name: "Pages", status: "operational" },
    ],
    maintenances: [],
    fetchedAt: "2026-08-20T10:00:00.000Z",
  });
  const state = await store.getState("github");
  assert.deepEqual(state.last?.components, [
    { id: "c1", name: "Actions", status: "degraded" },
    { id: "c2", name: "Pages", status: "operational" },
  ]);
  const buckets = await store.getComponentDailyBuckets("github", "c1", 7);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.worstStatus, "degraded");
  assert.equal(buckets[0]?.okSamples, 0);
  assert.equal(buckets[0]?.totalSamples, 1);
  await store.close();
});

test("an unknown component status writes no sample", async () => {
  const { store } = await harness();
  await store.saveStatus({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [{ id: "c1", name: "Actions", status: "unknown" }],
    maintenances: [],
    fetchedAt: "2026-08-20T10:00:00.000Z",
  });
  assert.deepEqual(await store.getComponentDailyBuckets("github", "c1", 7), []);
  await store.close();
});

test("pruning removes old component samples", async () => {
  const { store } = await harness();
  const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
  await store.saveStatus({
    provider: "github",
    overallStatus: "operational",
    activeIncidents: [],
    components: [{ id: "c1", name: "Actions", status: "degraded" }],
    maintenances: [],
    fetchedAt: old,
  });
  await store.pruneOlderThan(30);
  assert.deepEqual(await store.getComponentDailyBuckets("github", "c1", 365), []);
  await store.close();
});

/** Six resolved incidents, newest first: h6 … h1, an hour apart. */
async function seedIncidents(store: HistoryStore, provider = "github"): Promise<void> {
  await store.applyBackfill(provider, {
    samples: [],
    incidents: Array.from({ length: 6 }, (_unused, index) => {
      const started = new Date(Date.UTC(2026, 7, 10, 10 + index)).toISOString();
      return histIncident({
        id: `h${index + 1}`,
        startedAt: started,
        resolvedAt: new Date(Date.UTC(2026, 7, 10, 11 + index)).toISOString(),
        updatedAt: started,
      });
    }),
  });
}

test("listIncidents pages with limit and offset, newest first and without overlap", async () => {
  const { store } = await harness();
  await seedIncidents(store);

  const first = await store.listIncidents({ limit: 2, offset: 0 });
  const second = await store.listIncidents({ limit: 2, offset: 2 });
  const last = await store.listIncidents({ limit: 2, offset: 4 });

  assert.deepEqual(first.map((row) => row.incidentId), ["h6", "h5"]);
  assert.deepEqual(second.map((row) => row.incidentId), ["h4", "h3"]);
  assert.deepEqual(last.map((row) => row.incidentId), ["h2", "h1"]);
  assert.deepEqual(await store.listIncidents({ limit: 2, offset: 6 }), []);
  await store.close();
});

test("listIncidents pages a state-filtered list independently of the unfiltered one", async () => {
  const { store } = await harness();
  await seedIncidents(store);
  await store.saveStatus(snap());

  const openPage = await store.listIncidents({ state: "active", limit: 2, offset: 0 });
  const resolvedPage = await store.listIncidents({ state: "resolved", limit: 2, offset: 2 });

  assert.deepEqual(openPage.map((row) => row.incidentId), ["i1"]);
  assert.deepEqual(resolvedPage.map((row) => row.incidentId), ["h4", "h3"]);
  await store.close();
});

test("countIncidents totals every incident and the open ones, scoped by provider", async () => {
  const { store } = await harness(["cloudflare"]);
  await seedIncidents(store);
  await seedIncidents(store, "cloudflare");
  await store.saveStatus(snap());

  assert.deepEqual(await store.countIncidents({}), { all: 13, active: 1, resolved: 12 });
  assert.deepEqual(await store.countIncidents({ providerId: "github" }), { all: 7, active: 1, resolved: 6 });
  assert.deepEqual(await store.countIncidents({ providerId: "cloudflare" }), { all: 6, active: 0, resolved: 6 });
  await store.close();
});

test("countIncidents is all zeroes on an empty table", async () => {
  const { store } = await harness();
  assert.deepEqual(await store.countIncidents({}), { all: 0, active: 0, resolved: 0 });
  await store.close();
});

test("a window is remembered after it ends, and pruned when it ages out", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ maintenances: [mw()] }));
  // The provider stops declaring it once it has ended; the history row must
  // survive that even though the live NormalizedStatus no longer mentions it.
  await store.saveStatus({ ...snap({ maintenances: [] }), fetchedAt: "2026-08-20T05:00:00.000Z" });

  const [row] = await store.listMaintenances({ providerId: "github" });
  assert.equal(row?.id, "m1");
  assert.equal(row?.status, "scheduled");
  assert.equal(row?.endsAt, "2026-08-20T04:00:00.000Z");

  // Aged out: it ended two days before "now", pruneOlderThan(1) drops it.
  await store.saveStatus({
    ...snap({
      maintenances: [
        mw({
          id: "old",
          startsAt: "2026-08-18T02:00:00.000Z",
          endsAt: new Date(NOW.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
        }),
      ],
    }),
    fetchedAt: "2026-08-18T05:00:00.000Z",
  });
  await store.pruneOlderThan(1);

  const remaining = (await store.listMaintenances({ providerId: "github" })).map((r) => r.id);
  assert.deepEqual(remaining, ["m1"], "the window that ended within the retention window must survive pruning");
  await store.close();
});

test("first_seen_at is fixed at insert; last_seen_at moves on every later save", async () => {
  const { store } = await harness();
  await store.saveStatus(snap({ maintenances: [mw()] }));
  const first = (await store.listMaintenances({ providerId: "github" }))[0];
  assert.equal(first?.firstSeenAt, "2026-08-19T14:05:00.000Z");
  assert.equal(first?.lastSeenAt, "2026-08-19T14:05:00.000Z");

  await store.saveStatus({
    ...snap({ maintenances: [mw({ status: "in_progress" })] }),
    fetchedAt: "2026-08-20T02:30:00.000Z",
  });
  const second = (await store.listMaintenances({ providerId: "github" }))[0];
  assert.equal(second?.status, "in_progress", "the row keeps up with the provider's own lifecycle word");
  assert.equal(second?.firstSeenAt, "2026-08-19T14:05:00.000Z", "first_seen_at never moves once set");
  assert.equal(second?.lastSeenAt, "2026-08-20T02:30:00.000Z");
  await store.close();
});

test("listMaintenances is newest first by starts_at and honours providerIds, days and includeUpcoming", async () => {
  const { store } = await harness(["cloudflare"]);
  await store.saveStatus(snap({ provider: "github", maintenances: [mw({ id: "past", startsAt: "2026-08-10T00:00:00.000Z", endsAt: "2026-08-10T01:00:00.000Z" })] }));
  await store.saveStatus(
    snap({
      provider: "cloudflare",
      maintenances: [
        mw({ id: "upcoming", startsAt: "2026-08-25T00:00:00.000Z", endsAt: null }),
      ],
    }),
  );

  assert.deepEqual(
    (await store.listMaintenances({})).map((row) => row.id),
    ["upcoming", "past"],
    "newest starts_at first",
  );
  assert.deepEqual(
    (await store.listMaintenances({ providerIds: ["cloudflare"] })).map((row) => row.id),
    ["upcoming"],
  );
  assert.deepEqual(
    await store.listMaintenances({ providerIds: [] }),
    [],
    "an empty allow-list matches nothing",
  );
  assert.deepEqual(
    (await store.listMaintenances({ includeUpcoming: false })).map((row) => row.id),
    ["past"],
    "a window starting after now is excluded",
  );
  assert.deepEqual(
    (await store.listMaintenances({ days: 5 })).map((row) => row.id),
    ["upcoming"],
    "days is measured against starts_at",
  );
  await store.close();
});
