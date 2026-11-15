import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqliteStateStore } from "../../src/ui/sqliteStateStore.ts";
import { insertService } from "../../src/ui/dbConfigSource.ts";

/**
 * Roadmap 13.4. On a full disk SQLite rolls the failed transaction back
 * itself; a store that then issued its own `ROLLBACK` threw "cannot rollback —
 * no transaction is active" in place of the one sentence the operator needed:
 * the disk is full.
 */

/** A database whose disk is full: nothing more than the pages it has, and those packed. */
async function fullDatabase(): Promise<DatabaseSync> {
  const db = openDatabase(join(await mkdtemp(join(tmpdir(), "isitdown-dbfull-")), "isitdown.db"));
  migrate(db);
  insertService(db, { id: "fake", name: "Fake", adapter: "statuspage", baseUrl: "http://127.0.0.1:9", enabled: true, components: [] });
  const { page_count: pages } = db.prepare("PRAGMA page_count").get() as { page_count: number };
  db.exec(`PRAGMA max_page_count = ${pages + 8}`);
  db.exec("CREATE TABLE ballast (b BLOB)");
  assert.throws(() => {
    for (;;) db.prepare("INSERT INTO ballast VALUES (randomblob(512))").run();
  }, /full/);
  return db;
}

test("a write that does not fit says the disk is full, not that a rollback failed", async () => {
  const db = await fullDatabase();
  const store = createSqliteStateStore(db);
  const incident = { id: "i", name: "x".repeat(20_000), impact: "major", status: "investigating", updatedAt: new Date().toISOString() };
  await assert.rejects(
    store.saveStatus({
      provider: "fake",
      overallStatus: "major_outage",
      activeIncidents: [incident],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    }),
    /database or disk is full/,
  );
  // And the connection is usable again once there is room: no transaction left dangling.
  assert.equal(db.isTransaction, false);
  db.exec("PRAGMA max_page_count = 1073741823");
  await store.saveStatus({
    provider: "fake",
    overallStatus: "major_outage",
    activeIncidents: [incident],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  });
  db.close();
});
