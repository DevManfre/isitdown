import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate, SCHEMA_VERSION } from "./db/migrate.ts";
import { openDatabase } from "./db/open.ts";

/**
 * Backup and restore of the whole database, from the dashboard — roadmap 4.4.
 *
 * Nearly all of this edition's state is one SQLite file, so a backup is that
 * file and a restore is putting it back. Two things make it more than a file
 * copy:
 *
 *  - **A live file is not a snapshot.** The poller writes while the download
 *    streams, and WAL means the newest pages are in a second file next to it.
 *    `VACUUM INTO` is SQLite's own answer: one consistent, already-compacted
 *    copy, taken without stopping anything.
 *  - **The process holds the database open.** Overwriting the file underneath a
 *    live handle is how a database ends up half of each. The restore instead
 *    brings the uploaded file up to the current schema, attaches it, and copies
 *    it table by table into the open database inside one transaction — so the
 *    handle everything else in the runtime is holding stays valid, and no
 *    restart is needed for the dashboard to show the restored fleet.
 *
 * What a backup does *not* carry is `secrets.env` (roadmap 5.17), which lives
 * beside the database and holds the channel credentials. The report says so in
 * so many words rather than leaving it to be discovered on the day it matters.
 */

/** The tables a restore copies. Order matters: `services` before what references it. */
const TABLES = [
  "services",
  "settings",
  "channels",
  "routing_rules",
  "provider_state",
  "status_samples",
  "component_samples",
  "incidents",
  "maintenances",
  "notifications",
  "incident_notes",
  "message_refs",
  "push_subscriptions",
  "map_points",
  "map_geo_state",
] as const;

export interface BackupSnapshot {
  bytes: Buffer;
  /** What the download is called; the date is the operator's own filing system. */
  filename: string;
  /** True while the credentials file exists — the one thing this does not carry. */
  secretsExcluded: boolean;
}

export interface RestoreReport {
  /** Rows written per table, so the operator sees what actually came back. */
  tables: Record<string, number>;
  /** The schema version the uploaded file was at before it was brought forward. */
  fromSchemaVersion: number;
  schemaVersion: number;
  /** True while a credentials file exists here: a restore never replaces it. */
  secretsKept: boolean;
}

/** The name a download carries, dated so two backups do not overwrite each other. */
export function backupFilename(at: Date): string {
  return `isitdown-${at.toISOString().slice(0, 10)}.db`;
}

/**
 * A consistent copy of the whole database, taken with `VACUUM INTO` so the
 * bytes are a snapshot rather than a file being written to as it is read.
 */
export function createBackup(db: DatabaseSync, at: Date = new Date()): BackupSnapshot {
  const dir = mkdtempSync(join(tmpdir(), "isitdown-backup-"));
  const target = join(dir, "snapshot.db");
  try {
    // The path is this process's own temp directory, not anything an operator
    // can name: `VACUUM INTO` takes a string literal, and a path from outside
    // would be the whole of the injection surface here.
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    return {
      bytes: readFileSync(target),
      filename: backupFilename(at),
      secretsExcluded: true,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** SQLite's own magic. A file that does not start with it was never a database. */
const MAGIC = Buffer.from("SQLite format 3\0", "utf8");

/**
 * Whether the bytes are a database this edition wrote. Checked before anything
 * is copied: a restore is the one destructive action in the dashboard, and the
 * cheapest way to get it wrong is to point it at somebody else's `.db`.
 */
export function inspectBackup(bytes: Buffer): { version: number } {
  if (bytes.length < MAGIC.length || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("that file is not a SQLite database");
  }
  const dir = mkdtempSync(join(tmpdir(), "isitdown-restore-"));
  const path = join(dir, "upload.db");
  try {
    writeFileSync(path, bytes);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
          (row) => row.name,
        ),
      );
      // `services` and `settings` are in every version of this schema, and no
      // unrelated database has both under these names.
      if (!tables.has("services") || !tables.has("settings")) {
        throw new Error("that database is not an IsItDown backup");
      }
      const [row] = db.prepare("PRAGMA user_version").all() as { user_version: number }[];
      const version = row?.user_version ?? 0;
      if (version > SCHEMA_VERSION) {
        throw new Error(
          `that backup was written by a newer version of IsItDown (schema ${version}, this one reads ${SCHEMA_VERSION})`,
        );
      }
      return { version };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Replaces everything in the live database with the contents of `bytes`.
 *
 * The uploaded file is migrated to the current schema *first*, as its own
 * database: a backup from an older version then restores into a newer install
 * without the copy below having to know what changed between them. Only then is
 * it attached and copied in, inside one transaction — so a failure half way
 * leaves the database exactly as it was rather than half-restored.
 */
export function restoreBackup(db: DatabaseSync, bytes: Buffer, secretsPath?: string): RestoreReport {
  const { version } = inspectBackup(bytes);

  const dir = mkdtempSync(join(tmpdir(), "isitdown-restore-"));
  const path = join(dir, "upload.db");
  try {
    writeFileSync(path, bytes);
    const uploaded = openDatabase(path);
    try {
      // Brought forward in its own file, where a migration can add a column or
      // rewrite a table without touching anything the runtime is holding open.
      migrate(uploaded);
    } finally {
      uploaded.close();
    }

    const tables: Record<string, number> = {};
    db.exec(`ATTACH DATABASE '${path.replaceAll("'", "''")}' AS backup`);
    try {
      // Foreign keys are checked per statement, and a restore empties a parent
      // table before its children are refilled; the constraint is re-enabled
      // below, and the copied rows came from a database that already satisfied
      // it. `defer_foreign_keys` is scoped to this transaction alone.
      db.exec("PRAGMA defer_foreign_keys = ON");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of [...TABLES].reverse()) db.exec(`DELETE FROM main.${table}`);
        for (const table of TABLES) {
          // By name, never `SELECT *`: a column added by an `ALTER TABLE` sits
          // at the end of a migrated table and in the middle of a freshly
          // created one, so positional copying would silently shift values one
          // column across between an upgraded install and a new one.
          const shared = columnsOf(db, "main", table).filter((column) =>
            columnsOf(db, "backup", table).includes(column),
          );
          const list = shared.map((column) => `"${column}"`).join(", ");
          db.exec(`INSERT INTO main.${table} (${list}) SELECT ${list} FROM backup.${table}`);
          const [count] = db.prepare(`SELECT COUNT(*) AS n FROM main.${table}`).all() as { n: number }[];
          tables[table] = count?.n ?? 0;
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      db.exec("DETACH DATABASE backup");
    }

    return {
      tables,
      fromSchemaVersion: version,
      schemaVersion: SCHEMA_VERSION,
      secretsKept: secretsPath !== undefined && exists(secretsPath),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The column names one attached database's table has, in its own order. */
function columnsOf(db: DatabaseSync, schema: string, table: string): string[] {
  return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

function exists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
