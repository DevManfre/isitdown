import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDbMaintenance } from "../../src/ui/dbMaintenance.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { openDatabase } from "../../src/ui/db/open.ts";

async function database() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-vacuum-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  return db;
}

/** Enough samples that deleting them leaves whole pages behind to reclaim. */
function fillSamples(db: ReturnType<typeof openDatabase>, count: number): void {
  db.prepare("INSERT OR IGNORE INTO services (id, name, adapter, base_url, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .run("github", "GitHub", "statuspage", "https://www.githubstatus.com", new Date().toISOString());
  const insert = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, 'operational', 1)",
  );
  for (let index = 0; index < count; index += 1) {
    insert.run("github", new Date(Date.now() - index * 60_000).toISOString());
  }
}

test("a healthy database reports ok and is left intact", async () => {
  const db = await database();
  try {
    fillSamples(db, 200);

    const report = runDbMaintenance(db);

    assert.equal(report.ok, true);
    assert.equal(report.integrity, "ok");
    const [samples] = db.prepare("SELECT COUNT(*) AS n FROM status_samples").all() as { n: number }[];
    assert.equal(samples?.n, 200, "a vacuum rewrites the file, it does not delete rows");
  } finally {
    db.close();
  }
});

test("a large delete returns its pages, and the report names the bytes", async () => {
  const db = await database();
  try {
    fillSamples(db, 1500);
    runDbMaintenance(db); // Start from a compact file, so the delete is what frees pages.
    db.prepare("DELETE FROM status_samples").run();

    const report = runDbMaintenance(db);

    assert.equal(report.ok, true);
    assert.ok(report.reclaimed > 0, `expected reclaimed bytes, got ${report.reclaimed}`);
    assert.equal(report.reclaimed, report.bytesBefore - report.bytesAfter);
    assert.ok(report.bytesAfter < report.bytesBefore);
  } finally {
    db.close();
  }
});

test("a database with nothing to reclaim reports zero rather than a negative figure", async () => {
  const db = await database();
  try {
    fillSamples(db, 200);
    runDbMaintenance(db);

    const report = runDbMaintenance(db);

    assert.equal(report.ok, true);
    assert.equal(report.reclaimed, 0);
  } finally {
    db.close();
  }
});

test("the report carries how long it took", async () => {
  const db = await database();
  let clock = 1000;
  try {
    fillSamples(db, 100);

    const report = runDbMaintenance(db, () => (clock += 25));

    assert.equal(report.durationMs, 25);
  } finally {
    db.close();
  }
});
