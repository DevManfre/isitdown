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
  describeRouting,
  insertService,
  listChannels,
  listServices,
  readSettings,
  replaceRoutingRules,
  updateChannel,
  updateService,
  writeSettings,
} from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { RoutingRule } from "../../src/core/routing.ts";

const silent = createLogger("error", () => {});

async function freshDb(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-cfg-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  seedDefaults(db);
  return db;
}

/** Migrated but unseeded, so tests are free to use ids like "github" themselves. */
async function freshDbNoSeed(): Promise<DatabaseSync> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-cfg-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
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

test("a component selection round-trips through insert and list", async () => {
  const db = await freshDbNoSeed();
  insertService(db, {
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
    enabled: true,
    components: [{ id: "8l4ygp009s5s", name: "Git Operations" }],
  });
  const [service] = listServices(db);
  assert.deepEqual(service?.components, [{ id: "8l4ygp009s5s", name: "Git Operations" }]);
  db.close();
});

test("scoping to the selection round-trips and can be switched back off", async () => {
  const db = await freshDbNoSeed();
  insertService(db, {
    id: "cloudflare",
    name: "Cloudflare",
    adapter: "statuspage",
    baseUrl: "https://www.cloudflarestatus.com",
    enabled: true,
    components: [{ id: "57ctn3f2qsyj", name: "Amsterdam, Netherlands - (AMS)" }],
    scopeToComponents: true,
  });
  assert.equal(listServices(db)[0]?.scopeToComponents, true);

  updateService(db, "cloudflare", { scopeToComponents: false });
  assert.equal(listServices(db)[0]?.scopeToComponents, false);
  db.close();
});

test("updating the selection replaces it wholesale", async () => {
  const db = await freshDbNoSeed();
  insertService(db, {
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
    enabled: true,
    components: [{ id: "8l4ygp009s5s", name: "Git Operations" }],
  });
  updateService(db, "github", { components: [{ id: "4230lsnqdsld", name: "Webhooks" }] });
  const [service] = listServices(db);
  assert.deepEqual(service?.components, [{ id: "4230lsnqdsld", name: "Webhooks" }]);
  db.close();
});

test("a service stored before v2 lists an empty selection", async () => {
  const db = await freshDbNoSeed();
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, created_at, components) VALUES (?, ?, ?, ?, NULL, 1, ?, NULL)",
  ).run("legacy", "Legacy", "statuspage", "https://status.example.com", "2026-08-20T00:00:00.000Z");
  const service = listServices(db).find((entry) => entry.id === "legacy");
  assert.deepEqual(service?.components, []);
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

// Review finding 6: the cross-channel collision scan used to run on every
// patch, including an enabled-only toggle that touches no *Env field at all.
// An existing database that already has two *Env fields sharing a variable
// name (from before the guard existed, or a direct edit) would then lock the
// operator out of toggling *any* channel with a 400 about a field they never
// touched. The scan must run only when the patch actually carries `fields`.
test("an enabled-only patch succeeds even when a pre-existing collision is present in the database", async () => {
  const db = await freshDb();
  // Force a pre-existing collision directly, bypassing updateChannel's own
  // write-time guard — the scenario this guards against is a database that
  // reached this state before the guard existed, or via a direct edit.
  db.prepare("UPDATE channels SET config = ? WHERE id = ?").run(
    JSON.stringify({ publicKeyEnv: "SHARED_VAR", privateKeyEnv: "VAPID_PRIVATE_KEY" }),
    "webpush",
  );
  db.prepare("UPDATE channels SET config = ? WHERE id = ?").run(
    JSON.stringify({ urlEnv: "SHARED_VAR" }),
    "webhook",
  );

  // Toggling telegram — a channel with no part in the collision at all — must
  // not be blocked by a collision that lives entirely between two other rows.
  const ok = updateChannel(db, "telegram", { enabled: true });

  assert.equal(ok, true);
  assert.equal(listChannels(db).find((channel) => channel.id === "telegram")?.enabled, true);
  db.close();
});

test("migration seeds one catch-all rule, so an upgraded install behaves as before", async () => {
  const db = await freshDb();
  const { rules, invalidRules } = describeRouting(db, silent);

  assert.deepEqual(rules, [
    { provider: "*", classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: ["*"] },
  ]);
  assert.equal(invalidRules, 0);
  db.close();
});

test("rules are read back in the order they were written", async () => {
  const db = await freshDb();
  replaceRoutingRules(db, [
    { provider: "sentry", classes: ["status"], minSeverity: "any", channels: [] },
    { provider: "*", classes: ["status", "incident"], minSeverity: "major_outage", channels: ["telegram"] },
    { provider: "*", classes: ["maintenance", "monitoring"], minSeverity: "any", channels: ["slack"] },
  ]);

  const { rules } = describeRouting(db, silent);
  assert.deepEqual(
    rules.map((rule) => rule.provider),
    ["sentry", "*", "*"],
  );
  assert.deepEqual(rules[0]?.channels, []);
  db.close();
});

test("replacing the list is atomic: a rejected write leaves the previous order intact", async () => {
  const db = await freshDb();
  const good: RoutingRule[] = [
    { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
  ];
  replaceRoutingRules(db, good);

  assert.throws(() =>
    replaceRoutingRules(db, [
      { provider: "*", classes: ["status"], minSeverity: "any", channels: ["telegram"] },
      { provider: "*", classes: ["nope" as never], minSeverity: "any", channels: ["slack"] },
    ]),
  );

  assert.deepEqual(describeRouting(db, silent).rules, good);
  db.close();
});

test("an unreadable rule row is dropped, counted and logged rather than served", async () => {
  // Dropping a rule silently changes routing invisibly: losing a muting rule
  // resumes notifications, losing a broad one stops them. Both must be visible.
  const lines: string[] = [];
  const noisy = createLogger("error", (line) => lines.push(line));
  const db = await freshDb();
  db.prepare(
    "INSERT INTO routing_rules (position, provider, classes, min_severity, channels) VALUES (?, ?, ?, ?, ?)",
  ).run(1, "*", "not json", "any", '["*"]');

  const { rules, invalidRules } = describeRouting(db, noisy);
  assert.equal(rules.length, 1);
  assert.equal(invalidRules, 1);
  assert.equal(lines.length, 1);
  db.close();
});

test("a routing rule row whose JSON parses but whose values are illegal is dropped, counted and logged", async () => {
  // Sibling to the "unreadable rule row" (malformed JSON) test above: this
  // one parses as JSON fine, but min_severity is not a legal floor, so
  // routingRuleSchema itself rejects it — a different failure branch in
  // listRoutingRules with its own invalid += 1 / logger.error / continue.
  const lines: string[] = [];
  const noisy = createLogger("error", (line) => lines.push(line));
  const db = await freshDb();
  db.prepare(
    "INSERT INTO routing_rules (position, provider, classes, min_severity, channels) VALUES (?, ?, ?, ?, ?)",
  ).run(1, "*", '["status"]', "catastrophic", '["*"]');

  const { rules, invalidRules } = describeRouting(db, noisy);
  assert.equal(rules.length, 1);
  assert.equal(invalidRules, 1);
  assert.equal(lines.length, 1);
  db.close();
});

test("load falls back to the catch-all when the table is empty", async () => {
  const db = await freshDb();
  db.exec("DELETE FROM routing_rules");

  const config = await createDbConfigSource(db, {}, silent).load();
  assert.deepEqual(config.rules, [
    { provider: "*", classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: ["*"] },
  ]);
  db.close();
});

test("deleting a service deletes the rules that named it and leaves the others", async () => {
  const db = await freshDb();
  replaceRoutingRules(db, [
    { provider: "github", classes: ["status"], minSeverity: "any", channels: [] },
    { provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] },
  ]);

  assert.equal(deleteService(db, "github"), true);

  assert.deepEqual(
    describeRouting(db, silent).rules.map((rule) => rule.provider),
    ["*"],
  );
  db.close();
});

test("a database at the previous schema version gains the catch-all on migration", async () => {
  // The one test that shows nobody loses notifications by upgrading.
  const dir = await mkdtemp(join(tmpdir(), "isitdown-upgrade-"));
  const db = openDatabase(join(dir, "isitdown.db"));
  migrate(db);
  seedDefaults(db);
  db.exec("DELETE FROM routing_rules");
  db.exec("PRAGMA user_version = 8");

  migrate(db);

  assert.deepEqual(describeRouting(db, silent).rules, [
    { provider: "*", classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: ["*"] },
  ]);
  db.close();
});
