import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 3;

/**
 * Creates the schema. Idempotent and version-tracked in `PRAGMA user_version`, so
 * it runs on every boot and does nothing once the database is current.
 *
 * A provider's history hangs off its service row with ON DELETE CASCADE: removing
 * a provider from the dashboard must not leave uptime bars and incidents behind
 * for something no longer monitored.
 */
export function migrate(db: DatabaseSync): void {
  const [row] = db.prepare("PRAGMA user_version").all() as { user_version: number }[];
  const from = row?.user_version ?? 0;
  if (from >= SCHEMA_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      adapter     TEXT NOT NULL,
      base_url    TEXT NOT NULL,
      options     TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_state (
      provider_id       TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
      overall_status    TEXT NOT NULL,
      active_incidents  TEXT NOT NULL,
      fetched_at        TEXT NOT NULL,
      failure_count     INTEGER NOT NULL DEFAULT 0,
      degraded_notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS status_samples (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      observed_at    TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      ok             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      provider_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      incident_id TEXT NOT NULL,
      name        TEXT NOT NULL,
      impact      TEXT NOT NULL,
      status      TEXT NOT NULL,
      started_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      resolved_at TEXT,
      PRIMARY KEY (provider_id, incident_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      channel     TEXT NOT NULL,
      kind        TEXT NOT NULL,
      text        TEXT NOT NULL,
      sent_at     TEXT NOT NULL,
      ok          INTEGER NOT NULL,
      error       TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id      TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      config  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_status_samples_provider_time
      ON status_samples (provider_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_provider_started
      ON incidents (provider_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_sent
      ON notifications (sent_at);
  `);

  if (from < 2) {
    // PRAGMA guards make a half-applied upgrade safe to re-run.
    const serviceColumns = (db.prepare("PRAGMA table_info(services)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    if (!serviceColumns.includes("components")) {
      db.exec("ALTER TABLE services ADD COLUMN components TEXT");
    }
    const stateColumns = (db.prepare("PRAGMA table_info(provider_state)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    if (!stateColumns.includes("components")) {
      db.exec("ALTER TABLE provider_state ADD COLUMN components TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS component_samples (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        component_id TEXT NOT NULL,
        observed_at  TEXT NOT NULL,
        status       TEXT NOT NULL,
        ok           INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_component_samples_provider_component_time
        ON component_samples (provider_id, component_id, observed_at);
    `);
  }

  if (from < 3) {
    const serviceColumns = (db.prepare("PRAGMA table_info(services)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    if (!serviceColumns.includes("scope_to_components")) {
      db.exec("ALTER TABLE services ADD COLUMN scope_to_components INTEGER NOT NULL DEFAULT 0");
    }
  }

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
