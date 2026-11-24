import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, SCHEMA_WRITTEN_BY_KEY, schemaVersionOf } from "./migrate.ts";
import { rollback } from "./open.ts";
import { snapshotInto } from "./snapshot.ts";

/**
 * The way back from an upgrade — roadmap 10.2.
 *
 * Rolling an image back is a normal operation, and an older build refuses a
 * schema newer than its own (`NewerDatabaseError`). So before the image is
 * rolled back, the *newer* build — the only one that knows what its steps did —
 * takes the schema back down: `node dist/ui/server.js --migrate-down <N>`.
 *
 * Every step in `migrate.ts` has an entry here, keyed by the version it
 * upgrades *to*: a function that undoes it, or `null` where it cannot be
 * undone. A test holds the two files together, so a step added without saying
 * how it goes back fails CI rather than a rollback.
 *
 * What an inverse does is drop what the step added — the columns and tables,
 * and the rows in them. That is what going back to a schema that never had
 * them means; the copy taken first (`pre-down-v<N>.db`) is how the rows are
 * not lost for good.
 */

type Down = ((db: DatabaseSync) => void) | null;

const tableExists = (db: DatabaseSync, table: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;

/** Drops the columns that are there: a step's `up` adds each one only if missing, so its inverse checks too. */
function dropColumns(table: string, ...columns: string[]): (db: DatabaseSync) => void {
  return (db) => {
    if (!tableExists(db, table)) return;
    const present = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
    );
    for (const column of columns) {
      if (present.has(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  };
}

/** Drops whole tables, children first — their indexes go with them. */
function dropTables(...tables: string[]): (db: DatabaseSync) => void {
  return (db) => {
    for (const table of tables) db.exec(`DROP TABLE IF EXISTS ${table}`);
  };
}

const both =
  (...steps: ((db: DatabaseSync) => void)[]) =>
  (db: DatabaseSync): void => {
    for (const step of steps) step(db);
  };

/** Rows only, on tables the older schema has too: nothing to take back. */
const dataOnly = (): void => {};

export const DOWN: Readonly<Record<number, Down>> = {
  2: both(dropTables("component_samples"), dropColumns("services", "components"), dropColumns("provider_state", "components")),
  3: dropColumns("services", "scope_to_components"),
  4: dropTables("map_points", "map_geo_state"),
  // No step moved the schema to 5 that this code still carries: the upgrade to
  // 6 covers both, and a database at 5 has nothing 4 lacks.
  5: dataOnly,
  6: dropTables("push_subscriptions"),
  // Cannot be undone: it cleared every push subscription signed with the key
  // pair schema 6 read from the environment. Schema 7 is also the oldest a
  // supported release wrote (`test/fixtures/db/oldest-supported.db`), so it is
  // the floor of a downgrade either way.
  7: null,
  8: both(dropTables("maintenances"), dropColumns("provider_state", "maintenances")),
  // Routing rules: the step seeds the catch-all, and the table it goes in is
  // created with the base schema today — but schema 8 had no such table.
  9: dropTables("routing_rules"),
  10: dropColumns("services", "interval_minutes"),
  11: dropColumns("services", "deleted_at"),
  12: dropColumns("status_samples", "latency_ms"),
  13: dropColumns("notifications", "attempts"),
  // The webhook's `secretEnv` field stays: a JSON key an older build ignores.
  14: both(
    dropColumns("provider_state", "notify_baseline", "pending_signature", "pending_count"),
    dropColumns("services", "muted_until"),
  ),
  15: dropTables("message_refs"),
  16: dropColumns("services", "group_name"),
  17: dropTables("incident_notes"),
  18: dropColumns("services", "cross_checks"),
  19: both(dropTables("sla_notices"), dropColumns("services", "sla_target")),
  20: dropTables("trust_episodes"),
  21: both(dropColumns("status_samples", "adapter_version"), dropColumns("component_samples", "adapter_version")),
  22: dropTables("poll_cycles"),
  23: dropTables("annotations"),
  24: dropColumns("services", "authority"),
  25: both(dropTables("push_receipts"), dropColumns("incidents", "declared_at", "first_seen_at")),
  26: dropColumns("provider_state", "suspicions"),
  27: dropColumns("services", "interval_seconds"),
  28: dropColumns("provider_state", "freshness"),
  29: dropTables("incident_revisions", "incident_versions"),
  30: dropTables("heartbeats"),
  31: dropColumns("services", "depends_on"),
  32: dropTables("acks"),
  33: both(dropTables("incident_follows", "recipients"), dropColumns("services", "impact", "owner")),
  34: dropTables("dashboards"),
  35: dropColumns("dashboards", "position", "home"),
  36: dropColumns("services", "runbook", "tags", "mute_schedules", "maintenance_windows"),
  37: dropTables("config_snapshots"),
  38: dropTables("config_audit"),
  39: dropColumns("services", "favorite"),
  40: dropTables("status_readings"),
  41: both(dropTables("daily_rollups"), dropColumns("services", "outage_cost_per_hour")),
  42: dropTables("operator_points", "operator_series"),
};

/** The file holding the database as it was before going down to `version`. */
export const preDowngradeBackupName = (version: number): string => `pre-down-v${version}.db`;

/** The oldest schema a downgrade reaches: the version above the newest step with no inverse. */
export function downgradeFloor(): number {
  let floor = 1;
  for (let version = 2; version <= SCHEMA_VERSION; version++) {
    if (DOWN[version] === null) floor = version;
  }
  return floor;
}

export interface MigrateDownOptions {
  /** Where the copy taken first goes (`pre-down-v<N>.db`); unset, none is taken. */
  backupDir?: string;
}

export interface MigrateDownReport {
  from: number;
  to: number;
  /** The copy taken before the first drop; null when there was nowhere to put it. */
  backup: string | null;
}

/**
 * Takes the schema down to `target`, in one transaction, after a copy of the
 * file as it was. Everything that can refuse refuses before either: a target
 * that is not below the current schema, a schema this build does not know, or
 * a step on the way with no inverse.
 */
export function migrateDown(db: DatabaseSync, target: number, options: MigrateDownOptions = {}): MigrateDownReport {
  const from = schemaVersionOf(db);
  if (!Number.isInteger(target) || target < 1) throw new Error(`not a schema version: ${target}`);
  if (from > SCHEMA_VERSION) {
    throw new Error(`the database is at schema ${from}, newer than this version knows (${SCHEMA_VERSION}): run --migrate-down from the version that wrote it`);
  }
  if (target >= from) throw new Error(`the database is at schema ${from} already; --migrate-down only goes below it`);
  const floor = downgradeFloor();
  if (target < floor) {
    throw new Error(`schema ${floor} cannot be undone, so ${floor} is as far down as this goes (asked for ${target})`);
  }

  let backup: string | null = null;
  if (options.backupDir !== undefined) {
    backup = join(options.backupDir, preDowngradeBackupName(target));
    snapshotInto(db, backup);
  }

  db.exec("BEGIN");
  try {
    for (let version = from; version > target; version--) DOWN[version]?.(db);
    // No longer true, and the older build would never correct it.
    db.prepare("DELETE FROM settings WHERE key = ?").run(SCHEMA_WRITTEN_BY_KEY);
    db.exec(`PRAGMA user_version = ${target}`);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
  return { from, to: target, backup };
}
