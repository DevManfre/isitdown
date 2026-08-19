import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileConfigSource, loadConfig } from "../../src/light/config/loadConfig.ts";

async function configFile(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-config-"));
  const path = join(dir, "config.yml");
  await writeFile(path, body, "utf8");
  return path;
}

const FULL = `
pollIntervalMinutes: 5
requestTimeoutSeconds: 12
maxRetries: 2
failureThreshold: 4
locale: it

services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com/
    enabled: false

notifications:
  telegram:
    enabled: true
    botToken: "\${TELEGRAM_BOT_TOKEN}"
    chatId: "\${TELEGRAM_CHAT_ID}"
  webhook:
    enabled: false
    url: "\${WEBHOOK_URL}"
`;

const MINIMAL = `
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
`;

test("a full file maps onto a runtime config with the polling keys flattened", async () => {
  const config = await loadConfig(await configFile(FULL), {
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_CHAT_ID: "-100",
  });

  assert.deepEqual(config.polling, {
    intervalMinutes: 5,
    requestTimeoutSeconds: 12,
    maxRetries: 2,
    failureThreshold: 4,
  });
  assert.equal(config.locale, "it");
  assert.equal(config.services.length, 2);
  assert.equal(config.services[0]?.enabled, true);
  assert.equal(config.services[1]?.enabled, false);
  assert.equal(config.services[1]?.baseUrl, "https://www.cloudflarestatus.com", "trailing slash stripped");
});

test("environment references are substituted from the passed environment", async () => {
  const config = await loadConfig(await configFile(FULL), {
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_CHAT_ID: "-100",
  });
  const telegram = config.channels.find((channel) => channel.id === "telegram");
  assert.equal(telegram?.enabled, true);
  assert.equal(telegram?.settings["botToken"], "123:ABC");
  assert.equal(telegram?.settings["chatId"], "-100");
});

test("an enabled channel whose secret is unset is fatal and names the variable", async () => {
  await assert.rejects(
    loadConfig(await configFile(FULL), { TELEGRAM_CHAT_ID: "-100" }),
    /TELEGRAM_BOT_TOKEN/,
  );
});

test("a disabled channel with an unset variable is not an error", async () => {
  const config = await loadConfig(await configFile(FULL), {
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_CHAT_ID: "-100",
  });
  const webhook = config.channels.find((channel) => channel.id === "webhook");
  assert.equal(webhook?.enabled, false);
});

test("omitted optional keys fall back to the documented defaults", async () => {
  const config = await loadConfig(await configFile(MINIMAL), {});
  assert.deepEqual(config.polling, {
    intervalMinutes: 3,
    requestTimeoutSeconds: 8,
    maxRetries: 3,
    failureThreshold: 5,
  });
  assert.equal(config.locale, "en");
  assert.deepEqual(config.channels, []);
});

test("a missing file is fatal and names the path it looked for", async () => {
  const path = join(tmpdir(), "statuswatch-does-not-exist", "config.yml");
  await assert.rejects(loadConfig(path, {}), new RegExp(path.replace(/[/\\]/g, ".")));
});

test("malformed YAML is fatal and names the file", async () => {
  const path = await configFile("services:\n  - name: [unclosed\n");
  await assert.rejects(loadConfig(path, {}), /config/i);
});

test("a schema violation names the offending path", async () => {
  const path = await configFile(`
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
  - name: Broken
    id: broken
    adapter: statuspage
    baseUrl: not-a-url
`);
  await assert.rejects(loadConfig(path, {}), /services\.1\.baseUrl/);
});

test("a duplicate service id is fatal and names the id", async () => {
  const path = await configFile(`
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
  - name: GitHub again
    id: github
    adapter: statuspage
    baseUrl: https://example.com
`);
  await assert.rejects(loadConfig(path, {}), /github/);
});

test("a config with no services is fatal — there would be nothing to poll", async () => {
  await assert.rejects(loadConfig(await configFile("services: []\n"), {}), /services/);
});

test("an unknown notification channel is fatal and names it", async () => {
  const path = await configFile(`${MINIMAL}
notifications:
  carrierPigeon:
    enabled: true
`);
  await assert.rejects(loadConfig(path, {}), /carrierPigeon/);
});

test("an unresolved reference outside a channel is left visible rather than blanked", async () => {
  const path = await configFile(`
services:
  - name: Local
    id: local
    adapter: statuspage
    baseUrl: "\${STATUS_BASE_URL}"
`);
  await assert.rejects(loadConfig(path, {}), /STATUS_BASE_URL/);
});

test("the config source reads the file on every load, so an edit applies without a restart", async () => {
  const path = await configFile(MINIMAL);
  const source = createFileConfigSource(path, {});
  assert.equal((await source.load()).polling.intervalMinutes, 3);

  await writeFile(path, `pollIntervalMinutes: 9\n${MINIMAL}`, "utf8");
  assert.equal((await source.load()).polling.intervalMinutes, 9);
});
