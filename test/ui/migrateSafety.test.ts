import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import {
  migrate,
  NewerDatabaseError,
  preUpgradeBackupName,
  SCHEMA_VERSION,
  SCHEMA_WRITTEN_BY_KEY,
  schemaVersionOf,
} from "../../src/ui/db/migrate.ts";
import { DOWN, downgradeFloor, migrateDown, preDowngradeBackupName } from "../../src/ui/db/migrateDown.ts";
import { runMigrateDown } from "../../src/ui/migrateDownCommand.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * Roadmap 10.2: an older build refuses a newer database without touching it,
 * an upgrade copies the file before its first write, and every step has a way
 * back that lands on the schema it started from.
 */

const OLDEST = join(import.meta.dirname, "..", "fixtures", "db", "oldest-supported.db");

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "isitdown-migrate-safety-"));
}

/** The oldest supported release's own file, copied so the fixture is never written. */
async function oldestCopy(dir: string): Promise<string> {
  const path = join(dir, "isitdown.db");
  await copyFile(OLDEST, path);
  return path;
}

/** Every table, index and column as SQLite describes them — what "the same schema" means. */
function schemaOf(db: DatabaseSync): string[] {
  const objects = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
  const lines: string[] = [];
  for (const object of objects) {
    if (object.type === "table") {
      const columns = db.prepare(`PRAGMA table_xinfo(${object.name})`).all() as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];
      for (const column of columns) {
        lines.push(`${object.name}.${column.name} ${column.type} nn=${column.notnull} d=${column.dflt_value} pk=${column.pk}`);
      }
      const keys = db.prepare(`PRAGMA foreign_key_list(${object.name})`).all() as { table: string; from: string; on_delete: string }[];
      for (const key of keys) lines.push(`${object.name}.${key.from} -> ${key.table} ${key.on_delete}`);
    } else {
      lines.push(`${object.type} ${object.name} on ${object.tbl_name}`);
    }
  }
  return lines;
}

test("a database newer than this build stops the start with the versions in hand, and is not written", async () => {
  const dir = await scratch();
  const path = join(dir, "isitdown.db");
  const db = openDatabase(path);
  migrate(db);
  db.prepare("UPDATE settings SET value = '9.0.0' WHERE key = ?").run(SCHEMA_WRITTEN_BY_KEY);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const before = await readFile(path);

  const reopened = openDatabase(path);
  try {
    assert.throws(
      () => migrate(reopened, { backupDir: join(dir, "backups") }),
      (error: unknown) =>
        error instanceof NewerDatabaseError &&
        error.found === SCHEMA_VERSION + 1 &&
        error.known === SCHEMA_VERSION &&
        error.writtenBy === "9.0.0",
    );
  } finally {
    reopened.close();
  }
  assert.deepEqual(await readFile(path), before, "not one byte of the file moved");
  await assert.rejects(readdir(join(dir, "backups")), "no copy taken either: nothing was about to change");
});

test("an upgrade from the previous schema copies the file before it writes", async () => {
  const dir = await scratch();
  const path = await oldestCopy(dir);
  const db = openDatabase(path);
  const from = schemaVersionOf(db);
  assert.ok(from < SCHEMA_VERSION);

  const backup = migrate(db, { backupDir: join(dir, "backups") });
  db.close();

  assert.equal(backup, join(dir, "backups", preUpgradeBackupName(SCHEMA_VERSION)));
  const copy = new DatabaseSync(backup!, { readOnly: true });
  try {
    assert.equal(schemaVersionOf(copy), from, "the copy is the database as it was, before the upgrade");
    const [{ integrity_check }] = copy.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    assert.equal(integrity_check, "ok");
  } finally {
    copy.close();
  }
});

test("an upgrade records which IsItDown wrote the schema", async () => {
  const db = openDatabase(join(await scratch(), "isitdown.db"));
  migrate(db);
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SCHEMA_WRITTEN_BY_KEY) as { value: string };
  assert.equal(row.value, pkg.version);
  db.close();
});

test("a new database and a current one take no copy: there is nothing to go back to", async () => {
  const dir = await scratch();
  const db = openDatabase(join(dir, "isitdown.db"));
  assert.equal(migrate(db, { backupDir: join(dir, "backups") }), null, "new");
  assert.equal(migrate(db, { backupDir: join(dir, "backups") }), null, "already current");
  db.close();
  await assert.rejects(readdir(join(dir, "backups")));
});

test("every schema step says how it goes back, or that it cannot", () => {
  for (let version = 2; version <= SCHEMA_VERSION; version++) {
    assert.ok(version in DOWN, `schema ${version} has no entry in migrateDown.ts`);
  }
  assert.ok(!((SCHEMA_VERSION + 1) in DOWN), "an inverse for a step that does not exist yet");
});

test("up, down to the oldest supported schema, and up again gives the same schema", async () => {
  const dir = await scratch();
  const path = await oldestCopy(dir);
  const db = openDatabase(path);
  const oldest = schemaVersionOf(db);
  const oldestSchema = schemaOf(db);
  try {
    migrate(db);
    const upgraded = schemaOf(db);

    const report = migrateDown(db, oldest, { backupDir: join(dir, "backups") });
    assert.deepEqual({ from: report.from, to: report.to }, { from: SCHEMA_VERSION, to: oldest });
    assert.equal(schemaVersionOf(db), oldest);
    assert.deepEqual(schemaOf(db), oldestSchema, "down lands on the schema the oldest release wrote");

    migrate(db);
    assert.deepEqual(schemaOf(db), upgraded, "up again lands where the first upgrade did");
    const [{ integrity_check }] = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    assert.equal(integrity_check, "ok");
  } finally {
    db.close();
  }
});

test("a downgrade keeps the rows the older schema has a place for", async () => {
  const dir = await scratch();
  const db = openDatabase(await oldestCopy(dir));
  try {
    const before = (db.prepare("SELECT COUNT(*) AS n FROM status_samples").get() as { n: number }).n;
    assert.ok(before > 0, "the fixture carries history");
    migrate(db);
    migrateDown(db, downgradeFloor());
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM status_samples").get() as { n: number }).n, before);
  } finally {
    db.close();
  }
});

test("a downgrade copies the file first, and says where", async () => {
  const dir = await scratch();
  const db = openDatabase(join(dir, "isitdown.db"));
  try {
    migrate(db);
    const report = migrateDown(db, SCHEMA_VERSION - 1, { backupDir: join(dir, "backups") });
    assert.equal(report.backup, join(dir, "backups", preDowngradeBackupName(SCHEMA_VERSION - 1)));
    const copy = new DatabaseSync(report.backup!, { readOnly: true });
    assert.equal(schemaVersionOf(copy), SCHEMA_VERSION);
    copy.close();
  } finally {
    db.close();
  }
});

test("a downgrade past a step with no inverse is refused before anything changes", async () => {
  const dir = await scratch();
  const db = openDatabase(join(dir, "isitdown.db"));
  try {
    migrate(db);
    const floor = downgradeFloor();
    assert.equal(DOWN[floor], null, "the floor is a step that cannot be undone");
    assert.throws(() => migrateDown(db, floor - 1, { backupDir: join(dir, "backups") }), /cannot be undone/);
    assert.equal(schemaVersionOf(db), SCHEMA_VERSION);
    await assert.rejects(readdir(join(dir, "backups")), "refused before the copy, too");
    assert.throws(() => migrateDown(db, SCHEMA_VERSION), /only goes below/);
  } finally {
    db.close();
  }
});

test("--migrate-down takes a file down and leaves it for the older build to open", async () => {
  const dir = await scratch();
  const path = join(dir, "isitdown.db");
  const db = openDatabase(path);
  migrate(db);
  db.close();

  const writes: string[] = [];
  const write = process.stdout.write;
  const writeErr = process.stderr.write;
  process.stdout.write = ((chunk: string) => (writes.push(chunk), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => (writes.push(chunk), true)) as typeof process.stderr.write;
  let code: number;
  let bad: number;
  try {
    code = runMigrateDown(path, String(SCHEMA_VERSION - 2));
    bad = runMigrateDown(path, "soon");
  } finally {
    process.stdout.write = write;
    process.stderr.write = writeErr;
  }
  assert.equal(code, 0, writes.join(""));
  assert.equal(bad, 2);

  const after = new DatabaseSync(path, { readOnly: true });
  assert.equal(schemaVersionOf(after), SCHEMA_VERSION - 2);
  assert.equal(after.prepare("SELECT 1 FROM settings WHERE key = ?").get(SCHEMA_WRITTEN_BY_KEY), undefined);
  after.close();
});
