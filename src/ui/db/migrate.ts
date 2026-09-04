import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 9;

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

    -- No foreign key to services(id): "*" is not a service id, and a key here
    -- would block deleting a provider. deleteService drops a provider's rules
    -- explicitly instead, where it already cascades samples and incidents.
    CREATE TABLE IF NOT EXISTS routing_rules (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      position     INTEGER NOT NULL,
      provider     TEXT NOT NULL,
      classes      TEXT NOT NULL,
      min_severity TEXT NOT NULL,
      channels     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_status_samples_provider_time
      ON status_samples (provider_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_provider_started
      ON incidents (provider_id, started_at);
    -- The incident list is paged, and its order is the page's identity: without
    -- these three, every page sorts the whole table into a temp b-tree before it
    -- can skip to the requested offset. The two partial indexes cover the
    -- state-filtered pages, so a filtered page reads only the rows it returns
    -- instead of testing resolved_at over all of them.
    CREATE INDEX IF NOT EXISTS idx_incidents_started
      ON incidents (started_at, incident_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_open_started
      ON incidents (started_at, incident_id) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_incidents_closed_started
      ON incidents (started_at, incident_id) WHERE resolved_at IS NOT NULL;
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

  if (from < 4) {
    // Latest-snapshot only, on purpose: the map answers "where is the fleet
    // right now", and an append-only table at 450 components a poll would add
    // roughly 216k rows a day for one provider. Replay is an explicit non-goal.
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_points (
        provider_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        component_id TEXT NOT NULL,
        name         TEXT NOT NULL,
        lat          REAL NOT NULL,
        lon          REAL NOT NULL,
        source       TEXT NOT NULL,
        status       TEXT NOT NULL,
        observed_at  TEXT NOT NULL,
        PRIMARY KEY (provider_id, component_id)
      );

      -- Two jobs: the honest "N could not be placed" line the card shows, and
      -- the skip that keeps the map lane from re-fetching a provider whose
      -- components are all functional (GitHub) on every cycle.
      CREATE TABLE IF NOT EXISTS map_geo_state (
        provider_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
        located     INTEGER NOT NULL,
        total       INTEGER NOT NULL,
        checked_at  TEXT NOT NULL
      );
    `);
  }

  if (from < 6) {
    // A push subscription is a delivery address the browser hands out, not an
    // operator credential: it is useless without the VAPID private key, which
    // never leaves this process. `id` hashes the endpoint so re-subscribing the
    // same browser replaces the row instead of adding a second toast target.
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         TEXT PRIMARY KEY,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        label      TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  if (from < 7) {
    // The VAPID pair is generated and stored by src/ui/vapidKeys.ts now, so the
    // webpush row's two `*Env` references — the only reason the channel ever
    // showed environment-variable fields in the dashboard — are dropped. A
    // stale reference left here would still be described to the UI and would
    // still be checked against the environment for a value nothing reads.
    const row = db.prepare("SELECT config FROM channels WHERE id = 'webpush'").get() as
      | { config?: string }
      | undefined;
    if (row?.config !== undefined) {
      const config = JSON.parse(row.config) as Record<string, string>;
      delete config["publicKeyEnv"];
      delete config["privateKeyEnv"];
      db.prepare("UPDATE channels SET config = ? WHERE id = 'webpush'").run(JSON.stringify(config));
    }
    // Every existing subscription was registered against the key pair that used
    // to come from the environment, and the server now signs with one of its
    // own: those endpoints would reject each push (403, not the 410 that prunes
    // a device) and the operator would watch a device list that can no longer
    // receive anything. Clearing them makes the one working repair — press
    // "enable on this browser" again — the obvious one.
    db.exec("DELETE FROM push_subscriptions");
  }

  if (from < 8) {
    const stateColumns = (db.prepare("PRAGMA table_info(provider_state)").all() as { name: string }[]).map(
      (column) => column.name,
    );
    if (!stateColumns.includes("maintenances")) {
      db.exec("ALTER TABLE provider_state ADD COLUMN maintenances TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS maintenances (
        provider_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        maintenance_id TEXT NOT NULL,
        name           TEXT NOT NULL,
        status         TEXT NOT NULL,
        starts_at      TEXT NOT NULL,
        ends_at        TEXT,
        component_ids  TEXT NOT NULL,
        first_seen_at  TEXT NOT NULL,
        last_seen_at   TEXT NOT NULL,
        PRIMARY KEY (provider_id, maintenance_id)
      );
      CREATE INDEX IF NOT EXISTS idx_maintenances_provider_start ON maintenances (provider_id, starts_at);
    `);
  }

  if (from < 9) {
    // An installation upgrading here has no rules and would otherwise match
    // nothing, which means notifying nobody. The catch-all reproduces the
    // previous behaviour exactly, and being a real row it is visible and
    // editable in the dashboard instead of being a special case in the matcher.
    //
    // It targets every channel by wildcard rather than by name so that a
    // channel shipped in a future version is covered too. Enumerating would
    // leave the new channel in no rule at all, and it would silently never
    // notify — the same hazard seed.ts avoids by re-seeding channels on boot.
    const [existing] = db.prepare("SELECT COUNT(*) AS n FROM routing_rules").all() as { n: number }[];
    if ((existing?.n ?? 0) === 0) {
      db.prepare(
        "INSERT INTO routing_rules (position, provider, classes, min_severity, channels) VALUES (?, ?, ?, ?, ?)",
      ).run(
        0,
        "*",
        JSON.stringify(["status", "incident", "maintenance", "monitoring"]),
        "any",
        JSON.stringify(["*"]),
      );
    }
  }

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
