import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createRevisionService, revisionsBetween } from "../../src/ui/incidentRevisions.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { Adapter } from "../../src/core/adapter.interface.ts";
import type { HistoricalIncident } from "../../src/core/types.ts";

/**
 * Retroactive incident edits — roadmap 1.11. The comparison is a pure table;
 * the service is held to the three things a database adds to it: the first
 * version never moving, the same edit found twice being recorded once, and the
 * live impact standing in for the first one.
 */

const silent = createLogger("error", () => {});
const NOW = new Date("2026-10-09T12:00:00.000Z");

const resolved = (over: Partial<HistoricalIncident> = {}): HistoricalIncident => ({
  id: "inc-1",
  name: "Elevated errors",
  impact: "major",
  status: "resolved",
  startedAt: "2026-10-01T10:00:00.000Z",
  resolvedAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  ...over,
});

async function database(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-revisions-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run("acme", "Acme", "stub", "https://status.acme.example", NOW.toISOString());
  return db;
}

function service(db: DatabaseSync, feed: () => HistoricalIncident[]) {
  const adapter: Adapter = {
    id: "stub",
    fetchStatus: async () => {
      throw new Error("not read here");
    },
    fetchIncidentHistory: async () => ({ incidents: feed(), coverageStart: null }),
  };
  return createRevisionService({
    db,
    getAdapter: () => adapter,
    configSource: {
      load: async () =>
        ({
          polling: { requestTimeoutSeconds: 5 },
          services: [{ id: "acme", name: "Acme", adapter: "stub", baseUrl: "https://status.acme.example", enabled: true, components: [] }],
        }) as never,
    } as never,
    logger: silent,
    now: () => NOW,
  });
}

test("the comparison names every field a later read changed, and nothing else", () => {
  const first = { impact: "major", startedAt: "2026-10-01T10:00:00.000Z", resolvedAt: "2026-10-01T12:00:00.000Z" };
  assert.deepEqual(revisionsBetween(first, resolved()), []);
  assert.deepEqual(revisionsBetween(first, resolved({ impact: "minor", resolvedAt: "2026-10-01T10:30:00.000Z" })), [
    { field: "impact", before: "major", after: "minor" },
    { field: "resolved_at", before: "2026-10-01T12:00:00.000Z", after: "2026-10-01T10:30:00.000Z" },
  ]);
  assert.deepEqual(revisionsBetween(first, resolved({ startedAt: "2026-10-01T10:20:00.000Z" })), [
    { field: "started_at", before: "2026-10-01T10:00:00.000Z", after: "2026-10-01T10:20:00.000Z" },
  ]);
});

test("the same instant written with another offset, an unparseable stamp or a missing impact is no edit", () => {
  const first = { impact: "major", startedAt: "2026-10-01T10:00:00.000Z", resolvedAt: "2026-10-01T12:00:00.000Z" };
  assert.deepEqual(revisionsBetween(first, resolved({ startedAt: "2026-10-01T12:00:00+02:00" })), []);
  assert.deepEqual(revisionsBetween(first, resolved({ resolvedAt: "yesterday" })), []);
  assert.deepEqual(revisionsBetween(first, resolved({ impact: "" })), []);
});

test("the first read is the baseline, and a later edit is recorded once however often it is read", async () => {
  const db = await database();
  let feed = [resolved()];
  const revisions = service(db, () => feed);

  await revisions.checkAll();
  assert.deepEqual(revisions.revisions("acme", "inc-1"), [], "a first read has nothing to compare against");

  feed = [resolved({ impact: "minor", resolvedAt: "2026-10-01T10:30:00.000Z" })];
  await revisions.checkAll();
  await revisions.checkAll();
  assert.deepEqual(revisions.revisions("acme", "inc-1"), [
    { field: "impact", before: "major", after: "minor", observedAt: NOW.toISOString() },
    { field: "resolved_at", before: "2026-10-01T12:00:00.000Z", after: "2026-10-01T10:30:00.000Z", observedAt: NOW.toISOString() },
  ]);

  // Edited again: still held to the first version, not to the last one.
  feed = [resolved({ impact: "none", resolvedAt: "2026-10-01T10:30:00.000Z" })];
  await revisions.checkAll();
  assert.deepEqual(
    revisions.revisions("acme", "inc-1").map((revision) => `${revision.field}:${revision.before}->${revision.after}`),
    ["impact:major->minor", "resolved_at:2026-10-01T12:00:00.000Z->2026-10-01T10:30:00.000Z", "impact:major->none"],
  );
});

test("an impact lowered at resolution is caught against the impact last seen live", async () => {
  const db = await database();
  // What the live path wrote while the incident was open.
  db.prepare(
    `INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at)
     VALUES ('acme', 'inc-1', 'Elevated errors', 'critical', 'monitoring', '2026-10-01T10:01:00.000Z', '2026-10-01T11:00:00.000Z', '2026-10-01T12:03:00.000Z')`,
  ).run();
  const revisions = service(db, () => [resolved({ impact: "minor" })]);
  await revisions.checkAll();
  assert.deepEqual(
    revisions.revisions("acme", "inc-1").map((revision) => `${revision.field}:${revision.before}->${revision.after}`),
    ["impact:critical->minor"],
    "our own poll times are never compared against the provider's stamps",
  );
});

test("an incident still open, in the feed or in our own reading, is left alone", async () => {
  const db = await database();
  db.prepare(
    `INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at)
     VALUES ('acme', 'inc-2', 'Still going', 'critical', 'monitoring', '2026-10-01T10:01:00.000Z', '2026-10-01T11:00:00.000Z', NULL)`,
  ).run();
  const revisions = service(db, () => [resolved({ id: "inc-1", resolvedAt: null, impact: "minor" }), resolved({ id: "inc-2", impact: "minor" })]);
  await revisions.checkAll();
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM incident_versions").get() as { n: number }).n, 0);
});

test("the trust axis counts edited incidents against the ones read back inside the window", async () => {
  const db = await database();
  let feed = [resolved({ id: "a" }), resolved({ id: "b" }), resolved({ id: "old", resolvedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z" })];
  const revisions = service(db, () => feed);
  await revisions.checkAll();
  feed = [resolved({ id: "a", impact: "minor" }), resolved({ id: "b" }), resolved({ id: "old", impact: "minor", resolvedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z" })];
  await revisions.checkAll();
  assert.deepEqual(revisions.summary("acme", 30, NOW), { revised: 1, resolved: 2 });
  assert.deepEqual(revisions.summary("acme", 365, NOW), { revised: 2, resolved: 3 });
});

test("a feed that cannot be read costs a comparison, never a throw", async () => {
  const db = await database();
  const revisions = service(db, () => {
    throw new Error("HTTP 503");
  });
  await revisions.checkAll();
  assert.deepEqual(revisions.summary("acme", 90, NOW), { revised: 0, resolved: 0 });
});
