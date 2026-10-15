import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { createCoincidenceService } from "../../src/ui/coincidence.ts";
import type { HistoryStore } from "../../src/ui/historyStore.interface.ts";

const NOW = new Date("2026-08-20T18:00:00.000Z");

async function harness(ids = ["alpha", "beta", "gamma"]) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-coincidence-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  const insert = db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, 'statuspage', 'https://x.example', NULL, 1, '2026-01-01T00:00:00.000Z')",
  );
  for (const id of ids) insert.run(id, id);
  const store = createSqliteStateStore(db, { now: () => NOW });
  return { store, coincidence: createCoincidenceService(store, { now: () => NOW }) };
}

function incident(store: HistoryStore, providerId: string, id: string, startedAt: string, resolvedAt: string | null) {
  return store.applyBackfill(providerId, {
    samples: [],
    incidents: [
      {
        id,
        name: `${providerId} ${id}`,
        impact: "major",
        status: resolvedAt === null ? "investigating" : "resolved",
        startedAt,
        updatedAt: resolvedAt ?? startedAt,
        resolvedAt,
      },
    ],
  });
}

const hour = (day: number, h: number) =>
  `2026-08-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

test("a pair that overlaps often, against little open time, is listed", async () => {
  const { store, coincidence } = await harness();
  for (const day of [3, 6, 9, 12]) {
    await incident(store, "alpha", `a${day}`, hour(day, 10), hour(day, 11));
    await incident(store, "beta", `b${day}`, hour(day, 10), hour(day, 12));
  }
  await incident(store, "beta", "b-alone", hour(15, 1), hour(15, 2));

  const report = await coincidence.getReport(30);
  assert.equal(report.pairs.length, 1);
  const pair = report.pairs[0]!;
  assert.equal(pair.providerId, "alpha", "the provider with fewer incidents is the base");
  assert.equal(pair.otherId, "beta");
  assert.equal(pair.together, 4);
  assert.equal(pair.incidents, 4);
  assert.equal(pair.rate, 1);
  assert.ok(pair.lift > 3);
  assert.equal(pair.declared, false);
});

test("fewer than three overlaps is a coincidence, not a pattern", async () => {
  const { store, coincidence } = await harness();
  for (const day of [3, 6]) {
    await incident(store, "alpha", `a${day}`, hour(day, 10), hour(day, 11));
    await incident(store, "beta", `b${day}`, hour(day, 10), hour(day, 11));
  }
  assert.deepEqual((await coincidence.getReport(30)).pairs, []);
});

test("a provider that is always down overlaps everything and scores no lift", async () => {
  const { store, coincidence } = await harness();
  await incident(store, "beta", "forever", "2026-07-01T00:00:00.000Z", null);
  for (const day of [3, 6, 9]) await incident(store, "alpha", `a${day}`, hour(day, 10), hour(day, 11));
  assert.deepEqual((await coincidence.getReport(30)).pairs, []);
});

test("a pair already named in dependsOn is marked declared, either direction", async () => {
  const { store, coincidence } = await harness();
  for (const day of [3, 6, 9]) {
    await incident(store, "alpha", `a${day}`, hour(day, 10), hour(day, 11));
    await incident(store, "beta", `b${day}`, hour(day, 10), hour(day, 11));
  }
  const report = await coincidence.getReport(30, undefined, { beta: ["alpha"] });
  assert.equal(report.pairs[0]?.declared, true);
});

test("`only` leaves a disabled provider out of every pair", async () => {
  const { store, coincidence } = await harness();
  for (const day of [3, 6, 9]) {
    await incident(store, "alpha", `a${day}`, hour(day, 10), hour(day, 11));
    await incident(store, "beta", `b${day}`, hour(day, 10), hour(day, 11));
  }
  assert.deepEqual((await coincidence.getReport(30, ["alpha", "gamma"])).pairs, []);
});
