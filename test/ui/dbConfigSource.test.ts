import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/ui/db/open.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { seedDefaults } from "../../src/ui/db/seed.ts";
import {
  createDbConfigSource,
  deleteService,
  describeChannels,
  insertService,
  listChannels,
  listServices,
  readSettings,
  updateChannel,
  updateService,
  writeSettings,
} from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function freshDb(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-cfg-"));
  const db = openDatabase(join(dir, "statuswatch.db"));
  migrate(db);
  seedDefaults(db);
  return db;
}

test("load maps the seeded database onto a usable runtime config", async () => {
  const db = await freshDb();
  const config = await createDbConfigSource(db, {}, silent).load();

  assert.deepEqual(config.polling, {
    intervalMinutes: 3,
    requestTimeoutSeconds: 8,
    maxRetries: 3,
    failureThreshold: 5,
  });
  assert.equal(config.locale, "en");
  assert.deepEqual(
    config.services.map((service) => service.id).sort(),
    ["anthropic", "cloudflare", "github"],
  );
  assert.ok(config.services.every((service) => service.enabled));
  db.close();
});

test("a disabled service is excluded from the config the poller sees", async () => {
  const db = await freshDb();
  updateService(db, "github", { enabled: false });
  const config = await createDbConfigSource(db, {}, silent).load();
  assert.ok(!config.services.some((service) => service.id === "github"));
  db.close();
});

test("an enabled channel resolves its secret from the environment by name", async () => {
  const db = await freshDb();
  updateChannel(db, "telegram", { enabled: true });
  const config = await createDbConfigSource(
    db,
    { TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" },
    silent,
  ).load();

  const telegram = config.channels.find((channel) => channel.id === "telegram");
  assert.equal(telegram?.enabled, true);
  assert.equal(telegram?.settings["botToken"], "123:ABC");
  assert.equal(telegram?.settings["chatId"], "-100");
  db.close();
});

test("an enabled channel whose variable is unset comes back disabled with a warning, not a crash", async () => {
  const db = await freshDb();
  updateChannel(db, "telegram", { enabled: true });
  const warnings: string[] = [];
  const config = await createDbConfigSource(
    db,
    {},
    createLogger("warn", (line) => warnings.push(line)),
  ).load();

  const telegram = config.channels.find((channel) => channel.id === "telegram");
  assert.equal(telegram?.enabled, false, "the dashboard must keep serving, just without that channel");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /TELEGRAM_BOT_TOKEN/);
  db.close();
});

test("a service row that violates the shared schema is skipped, not fatal", async () => {
  const db = await freshDb();
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)",
  ).run("broken", "Broken", "statuspage", "not-a-url", "2026-08-19T00:00:00.000Z");

  const warnings: string[] = [];
  const config = await createDbConfigSource(
    db,
    {},
    createLogger("warn", (line) => warnings.push(line)),
  ).load();

  assert.ok(!config.services.some((service) => service.id === "broken"));
  assert.equal(config.services.length, 3, "one bad row must not poison the whole cycle");
  assert.match(warnings.join(" "), /broken/);
  db.close();
});

test("writing a setting is visible to the next load, which is what makes it hot", async () => {
  const db = await freshDb();
  const source = createDbConfigSource(db, {}, silent);
  assert.equal((await source.load()).polling.intervalMinutes, 3);

  writeSettings(db, { pollIntervalMinutes: 10 });

  assert.equal((await source.load()).polling.intervalMinutes, 10);
  db.close();
});

test("settings are validated on the way out, so a corrupt row falls back instead of crashing", async () => {
  const db = await freshDb();
  db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("banana", "pollIntervalMinutes");
  const warnings: string[] = [];
  const settings = readSettings(db, createLogger("warn", (line) => warnings.push(line)));
  assert.equal(settings.pollIntervalMinutes, 3);
  assert.match(warnings.join(" "), /pollIntervalMinutes/);
  db.close();
});

test("describeChannels reports which variable carries each credential and whether it is set", async () => {
  const db = await freshDb();
  const described = describeChannels(db, { TELEGRAM_BOT_TOKEN: "123:ABC" });
  const telegram = described.find((channel) => channel.id === "telegram");

  assert.equal(telegram?.enabled, false);
  assert.deepEqual(telegram?.fields, [
    { name: "botToken", envVar: "TELEGRAM_BOT_TOKEN", isSet: true },
    { name: "chatId", envVar: "TELEGRAM_CHAT_ID", isSet: false },
  ]);
  db.close();
});

test("describeChannels never exposes a secret value", async () => {
  const db = await freshDb();
  const described = describeChannels(db, {
    TELEGRAM_BOT_TOKEN: "123:SUPERSECRET",
    TELEGRAM_CHAT_ID: "-100",
    WEBHOOK_URL: "https://hooks.example/secret-path",
  });
  const serialised = JSON.stringify(described);
  assert.ok(!serialised.includes("SUPERSECRET"), serialised);
  assert.ok(!serialised.includes("secret-path"), serialised);
  db.close();
});

test("services can be added, edited and removed through the helpers", async () => {
  const db = await freshDb();
  insertService(db, {
    id: "vercel",
    name: "Vercel",
    adapter: "statuspage",
    baseUrl: "https://www.vercel-status.com",
    enabled: true,
  });
  assert.ok(listServices(db).some((service) => service.id === "vercel"));

  updateService(db, "vercel", { name: "Vercel Platform" });
  assert.equal(listServices(db).find((service) => service.id === "vercel")?.name, "Vercel Platform");

  deleteService(db, "vercel");
  assert.ok(!listServices(db).some((service) => service.id === "vercel"));
  db.close();
});

test("inserting a duplicate service id is refused", async () => {
  const db = await freshDb();
  assert.throws(() =>
    insertService(db, {
      id: "github",
      name: "GitHub again",
      adapter: "statuspage",
      baseUrl: "https://example.com",
      enabled: true,
    }),
  );
  db.close();
});

test("updating or deleting an unknown service is reported rather than silently ignored", async () => {
  const db = await freshDb();
  assert.equal(updateService(db, "nope", { name: "x" }), false);
  assert.equal(deleteService(db, "nope"), false);
  assert.equal(updateService(db, "github", { name: "GitHub" }), true);
  db.close();
});

test("a channel's environment variable name can be changed but a value cannot be stored", async () => {
  const db = await freshDb();
  updateChannel(db, "webhook", { fields: { urlEnv: "MY_OWN_HOOK" } });
  const stored = listChannels(db).find((channel) => channel.id === "webhook");
  assert.deepEqual(stored?.config, { urlEnv: "MY_OWN_HOOK" });

  assert.throws(
    () => updateChannel(db, "webhook", { fields: { url: "https://hooks.example/x" } }),
    /Env/,
    "the store must refuse anything that is not an environment variable reference",
  );
  db.close();
});
