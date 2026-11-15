import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseCorruptError, openDatabase } from "../../src/ui/db/open.ts";

/**
 * Roadmap 10.4. A power cut halfway through a write is the most ordinary
 * failure a homelab has: the settings that make it survivable are asserted
 * here rather than trusted, and a file that did not survive stops the start
 * instead of being written to.
 */

async function freshPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "isitdown-dbopen-")), "isitdown.db");
}

/** A database with real rows in it, closed so the WAL is folded back into the file. */
async function populated(): Promise<string> {
  const path = await freshPath();
  const db = openDatabase(path);
  db.exec("CREATE TABLE drill (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO drill (body) VALUES (?)");
  db.exec("BEGIN");
  for (let i = 0; i < 2000; i++) insert.run(`row number ${i} `.repeat(4));
  db.exec("COMMIT");
  db.close();
  return path;
}

/** Overwrites one page in the middle of the file with garbage. */
function corruptPage(path: string, page: number): void {
  const fd = openSync(path, "r+");
  try {
    writeSync(fd, Buffer.alloc(4096, 0xab), 0, 4096, page * 4096);
  } finally {
    closeSync(fd);
  }
}

test("the database opens in WAL mode, with full fsync and foreign keys on", async () => {
  const db = openDatabase(await freshPath());
  try {
    const pragma = (name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    assert.equal(pragma("journal_mode"), "wal");
    // FULL (2): a committed cycle survives a power cut, not only a crash.
    assert.equal(pragma("synchronous"), 2);
    assert.equal(pragma("foreign_keys"), 1);
  } finally {
    db.close();
  }
});

test("a database with a corrupt page refuses to open, says where it is, and is left untouched", async () => {
  const path = await populated();
  corruptPage(path, 3);
  const before = readFileSync(path);

  assert.throws(
    () => openDatabase(path),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseCorruptError);
      assert.equal(error.path, path);
      assert.ok(error.detail.length > 0);
      return true;
    },
  );
  assert.deepEqual(readFileSync(path), before);
});

test("a file that is not a database at all is reported the same way", async () => {
  const path = await freshPath();
  const fd = openSync(path, "w");
  writeSync(fd, Buffer.alloc(8192, 0x41));
  closeSync(fd);
  assert.throws(() => openDatabase(path), DatabaseCorruptError);
});

test("a healthy database with rows opens normally", async () => {
  const db = openDatabase(await populated());
  try {
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM drill").get() as { n: number }).n, 2000);
  } finally {
    db.close();
  }
});
