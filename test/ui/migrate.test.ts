import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate, SCHEMA_VERSION } from "../../src/ui/db/migrate.ts";
import { seedDefaults } from "../../src/ui/db/seed.ts";

async function freshDb(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-db-"));
  return openDatabase(join(dir, "isitdown.db"));
}

const names = (db: DatabaseSync, type: "table" | "index"): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all(type) as {
    name: string;
  }[])
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_"));

test("migrate creates every table the dashboard reads", async () => {
  const db = await freshDb();
  migrate(db);
  assert.deepEqual(names(db, "table"), [
    "channels",
    "component_samples",
    "incidents",
    "notifications",
    "provider_state",
    "services",
    "settings",
    "status_samples",
  ]);
  db.close();
});

test("migrate indexes the columns the history queries filter on", async () => {
  const db = await freshDb();
  migrate(db);
  const indexes = names(db, "index");
  assert.ok(
    indexes.some((name) => name.includes("status_samples")),
    `expected a status_samples index, got ${indexes.join(", ")}`,
  );
  assert.ok(indexes.some((name) => name.includes("incidents")));
  assert.ok(indexes.some((name) => name.includes("notifications")));
  db.close();
});

test("migrate records the schema version", async () => {
  const db = await freshDb();
  migrate(db);
  const [row] = db.prepare("PRAGMA user_version").all() as { user_version: number }[];
  assert.equal(row?.user_version, SCHEMA_VERSION);
  db.close();
});

test("migrate is idempotent and never touches existing rows", async () => {
  const db = await freshDb();
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("github", "GitHub", "statuspage", "https://www.githubstatus.com", null, 1, "2026-08-19T00:00:00.000Z");

  migrate(db);
  migrate(db);

  const rows = db.prepare("SELECT id FROM services").all() as { id: string }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    ["github"],
  );
  db.close();
});

test("a fresh database gets the v2 component schema", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name);
  assert.ok(tables.includes("component_samples"));
  const serviceColumns = db.prepare("PRAGMA table_info(services)").all().map((row) => (row as { name: string }).name);
  assert.ok(serviceColumns.includes("components"));
  assert.ok(serviceColumns.includes("scope_to_components"));
  const stateColumns = db.prepare("PRAGMA table_info(provider_state)").all().map((row) => (row as { name: string }).name);
  assert.ok(stateColumns.includes("components"));
});

test("migrating from user_version 1 adds columns and keeps data", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, adapter TEXT NOT NULL,
      base_url TEXT NOT NULL, options TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE provider_state (
      provider_id TEXT PRIMARY KEY, overall_status TEXT NOT NULL,
      active_incidents TEXT NOT NULL, fetched_at TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0, degraded_notified INTEGER NOT NULL DEFAULT 0
    );
    PRAGMA user_version = 1;
  `);
  db.prepare("INSERT INTO services (id, name, adapter, base_url, created_at) VALUES (?, ?, ?, ?, ?)").run(
    "github", "GitHub", "statuspage", "https://www.githubstatus.com", "2026-08-20T00:00:00.000Z",
  );
  migrate(db);
  const columns = db.prepare("PRAGMA table_info(services)").all().map((row) => (row as { name: string }).name);
  assert.ok(columns.includes("components"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number } | undefined)?.n, 1);
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined)?.user_version,
    3,
  );
});

test("migrating from user_version 2 adds the scope column, defaulting to the whole page", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, adapter TEXT NOT NULL,
      base_url TEXT NOT NULL, options TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      components TEXT, created_at TEXT NOT NULL
    );
    PRAGMA user_version = 2;
  `);
  db.prepare("INSERT INTO services (id, name, adapter, base_url, created_at) VALUES (?, ?, ?, ?, ?)").run(
    "github", "GitHub", "statuspage", "https://www.githubstatus.com", "2026-08-20T00:00:00.000Z",
  );
  migrate(db);
  const row = db.prepare("SELECT scope_to_components FROM services WHERE id = 'github'").get() as
    | { scope_to_components: number }
    | undefined;
  // An upgrade must not narrow a provider the operator never asked to narrow.
  assert.equal(row?.scope_to_components, 0);
});

test("seedDefaults gives a fresh database three providers to watch", async () => {
  const db = await freshDb();
  migrate(db);
  seedDefaults(db);
  const rows = db.prepare("SELECT id, adapter, base_url, enabled FROM services ORDER BY id").all() as {
    id: string;
    adapter: string;
    base_url: string;
    enabled: number;
  }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    ["anthropic", "cloudflare", "github"],
  );
  assert.ok(rows.every((row) => row.adapter === "statuspage"));
  assert.ok(rows.every((row) => row.enabled === 1));
  assert.equal(rows.find((row) => row.id === "anthropic")?.base_url, "https://status.claude.com");
  db.close();
});

test("seedDefaults writes the polling and preference defaults", async () => {
  const db = await freshDb();
  migrate(db);
  seedDefaults(db);
  const settings = Object.fromEntries(
    (db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[]).map(
      (row) => [row.key, row.value],
    ),
  );
  assert.deepEqual(settings, {
    pollIntervalMinutes: "3",
    requestTimeoutSeconds: "8",
    maxRetries: "3",
    failureThreshold: "5",
    theme: "system",
    uiLocale: "en",
    notificationLocale: "en",
  });
  db.close();
});

test("seedDefaults registers both channels, disabled, referencing environment variables by name", async () => {
  const db = await freshDb();
  migrate(db);
  seedDefaults(db);
  const rows = db.prepare("SELECT id, enabled, config FROM channels ORDER BY id").all() as {
    id: string;
    enabled: number;
    config: string;
  }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    ["telegram", "webhook"],
  );
  assert.ok(rows.every((row) => row.enabled === 0), "a seeded channel must start disabled");

  const telegram = JSON.parse(rows[0]?.config ?? "{}") as Record<string, string>;
  assert.deepEqual(telegram, { botTokenEnv: "TELEGRAM_BOT_TOKEN", chatIdEnv: "TELEGRAM_CHAT_ID" });
  const webhook = JSON.parse(rows[1]?.config ?? "{}") as Record<string, string>;
  assert.deepEqual(webhook, { urlEnv: "WEBHOOK_URL" });

  // Every stored key names a variable; none holds a value.
  for (const row of rows) {
    for (const key of Object.keys(JSON.parse(row.config) as Record<string, string>)) {
      assert.match(key, /Env$/, `${row.id}.${key} must be an environment variable reference`);
    }
  }
  db.close();
});

test("seedDefaults leaves a database that already has services alone", async () => {
  const db = await freshDb();
  migrate(db);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("vercel", "Vercel", "statuspage", "https://www.vercel-status.com", null, 1, "2026-08-19T00:00:00.000Z");

  seedDefaults(db);

  const rows = db.prepare("SELECT id FROM services").all() as { id: string }[];
  assert.deepEqual(
    rows.map((row) => row.id),
    ["vercel"],
    "an operator's provider list must never be overwritten",
  );
  db.close();
});

test("seedDefaults run twice does not duplicate anything", async () => {
  const db = await freshDb();
  migrate(db);
  seedDefaults(db);
  seedDefaults(db);
  const [services] = db.prepare("SELECT COUNT(*) AS n FROM services").all() as { n: number }[];
  const [channels] = db.prepare("SELECT COUNT(*) AS n FROM channels").all() as { n: number }[];
  assert.equal(services?.n, 3);
  assert.equal(channels?.n, 2);
  db.close();
});

test("the database enforces foreign keys and runs in WAL mode", async () => {
  const db = await freshDb();
  const [fk] = db.prepare("PRAGMA foreign_keys").all() as { foreign_keys: number }[];
  const [journal] = db.prepare("PRAGMA journal_mode").all() as { journal_mode: string }[];
  assert.equal(fk?.foreign_keys, 1);
  assert.equal(journal?.journal_mode, "wal");
  db.close();
});

test("deleting a service takes its history with it", async () => {
  const db = await freshDb();
  migrate(db);
  seedDefaults(db);
  db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, ?, ?)",
  ).run("github", "2026-08-19T14:00:00.000Z", "operational", 1);

  db.prepare("DELETE FROM services WHERE id = ?").run("github");

  const [samples] = db
    .prepare("SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = ?")
    .all("github") as { n: number }[];
  assert.equal(samples?.n, 0, "orphaned history would keep showing a deleted provider");
  db.close();
});
