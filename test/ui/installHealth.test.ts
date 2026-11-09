import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../../src/ui/db/migrate.ts";
import {
  ABANDONED_AFTER_DAYS,
  abandonedProviders,
  installChecks,
  noteInstallEvent,
  STALE_TEST_DAYS,
} from "../../src/ui/installHealth.ts";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  db.exec("DELETE FROM services");
  return db;
}

function addService(db: DatabaseSync, id: string, enabled: boolean): void {
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, 'statuspage', 'https://example.com', ?, ?)",
  ).run(id, id.toUpperCase(), enabled ? 1 : 0, daysAgo(400));
}

function addSample(db: DatabaseSync, id: string, at: string, ok: boolean): void {
  db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, ?, ?)",
  ).run(id, at, ok ? "operational" : "unknown", ok ? 1 : 0);
}

function addAudit(db: DatabaseSync, id: string, at: string, after: boolean): void {
  db.prepare(
    "INSERT INTO config_audit (at, actor, method, route, kind, target, field, before, after) VALUES (?, 'local', 'PUT', '/config/services', 'service', ?, 'enabled', ?, ?)",
  ).run(at, id, JSON.stringify(!after), JSON.stringify(after));
}

test("a provider disabled for longer than the window is abandoned, one disabled recently is not", () => {
  const db = freshDb();
  addService(db, "old", false);
  addAudit(db, "old", daysAgo(ABANDONED_AFTER_DAYS + 5), false);
  addService(db, "recent", false);
  addAudit(db, "recent", daysAgo(3), false);

  const found = abandonedProviders(db, NOW);
  assert.deepEqual(
    found.map((p) => [p.id, p.reason]),
    [["old", "disabled"]],
  );
  assert.equal(found[0]?.since, daysAgo(ABANDONED_AFTER_DAYS + 5));
});

test("a provider re-enabled after being disabled is not abandoned", () => {
  const db = freshDb();
  addService(db, "back", true);
  addAudit(db, "back", daysAgo(90), false);
  addAudit(db, "back", daysAgo(10), true);
  assert.deepEqual(abandonedProviders(db, NOW), []);
});

test("a provider whose probe has not succeeded for the whole window is abandoned, since its last success", () => {
  const db = freshDb();
  addService(db, "dead", true);
  addSample(db, "dead", daysAgo(60), true);
  addSample(db, "dead", daysAgo(45), false);
  addSample(db, "dead", daysAgo(1), false);

  const [found] = abandonedProviders(db, NOW);
  assert.equal(found?.id, "dead");
  assert.equal(found?.reason, "failing");
  assert.equal(found?.since, daysAgo(60));
});

test("a provider with too little history to tell is not called abandoned", () => {
  const db = freshDb();
  addService(db, "new", true);
  addSample(db, "new", daysAgo(5), false);
  addSample(db, "new", daysAgo(1), false);
  assert.deepEqual(abandonedProviders(db, NOW), []);
});

test("a provider that still succeeds is not abandoned even after a long failing run", () => {
  const db = freshDb();
  addService(db, "flaky", true);
  addSample(db, "flaky", daysAgo(60), false);
  addSample(db, "flaky", daysAgo(2), true);
  assert.deepEqual(abandonedProviders(db, NOW), []);
});

const healthy = {
  enabledChannels: 1,
  retentionDays: 120,
  update: "current" as const,
  publicPageEnabled: false,
  apiTokenSet: false,
};

function state(checks: ReturnType<typeof installChecks>, id: string): string | undefined {
  return checks.find((check) => check.id === id)?.state;
}

test("a channel never tested and a backup never made warn; the rest pass", () => {
  const db = freshDb();
  const checks = installChecks(db, healthy, NOW);
  assert.equal(state(checks, "channels"), "ok");
  assert.equal(state(checks, "channel-test"), "warn");
  assert.equal(state(checks, "backup"), "warn");
  assert.equal(state(checks, "retention"), "ok");
  assert.equal(state(checks, "version"), "ok");
  assert.equal(state(checks, "token"), "ok");
});

test("a recent test and a backup turn those checks green; a test older than the window turns back", () => {
  const db = freshDb();
  noteInstallEvent(db, "channelTest", new Date(NOW - 86_400_000));
  noteInstallEvent(db, "backup", new Date(NOW - 86_400_000));
  let checks = installChecks(db, healthy, NOW);
  assert.equal(state(checks, "channel-test"), "ok");
  assert.equal(state(checks, "backup"), "ok");

  noteInstallEvent(db, "channelTest", new Date(NOW - (STALE_TEST_DAYS + 1) * 86_400_000));
  checks = installChecks(db, healthy, NOW);
  assert.equal(state(checks, "channel-test"), "warn");
});

test("with no channel configured the test check has nothing to ask of the operator", () => {
  const db = freshDb();
  const checks = installChecks(db, { ...healthy, enabledChannels: 0 }, NOW);
  assert.equal(state(checks, "channels"), "warn");
  assert.equal(state(checks, "channel-test"), "ok");
});

test("minimum retention, an available update, and a public page without a token each warn", () => {
  const db = freshDb();
  const checks = installChecks(
    db,
    { ...healthy, retentionDays: 7, update: "available", publicPageEnabled: true },
    NOW,
  );
  assert.equal(state(checks, "retention"), "warn");
  assert.equal(state(checks, "version"), "warn");
  assert.equal(state(checks, "token"), "warn");
});

test("an update check that is off or has not answered is unknown, never a pass", () => {
  const db = freshDb();
  assert.equal(state(installChecks(db, { ...healthy, update: "unknown" }, NOW), "version"), "unknown");
  assert.equal(state(installChecks(db, { ...healthy, update: "failed" }, NOW), "version"), "unknown");
});
