import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../src/core/logger.ts";
import { loadSecretsFile } from "../../src/ui/secretsFile.ts";

const silent = createLogger("error", () => {});

const where = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), "isitdown-secrets-")), "secrets.env");

test("a missing file loads as an empty store and owns nothing", async () => {
  const env: NodeJS.ProcessEnv = {};
  const secrets = await loadSecretsFile(await where(), env, silent);

  assert.equal(secrets.owns("DISCORD_WEBHOOK_URL"), false);
  assert.deepEqual(env, {});
});

test("a saved secret reaches the environment at once and the file on disk", async () => {
  const path = await where();
  const env: NodeJS.ProcessEnv = {};
  const secrets = await loadSecretsFile(path, env, silent);

  await secrets.set({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" });

  assert.equal(env["DISCORD_WEBHOOK_URL"], "https://discord.com/api/webhooks/1/abc");
  assert.equal(secrets.owns("DISCORD_WEBHOOK_URL"), true);
  assert.match(await readFile(path, "utf8"), /^DISCORD_WEBHOOK_URL=https:\/\/discord\.com\/api\/webhooks\/1\/abc$/m);
});

test("the file is written for its owner only", async () => {
  const path = await where();
  const secrets = await loadSecretsFile(path, {}, silent);

  await secrets.set({ TELEGRAM_BOT_TOKEN: "123:abc" });

  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a restart re-applies what was saved, so a value outlives the process", async () => {
  const path = await where();
  await (await loadSecretsFile(path, {}, silent)).set({ WEBHOOK_URL: "https://example.com/hook" });

  const env: NodeJS.ProcessEnv = {};
  await loadSecretsFile(path, env, silent);

  assert.equal(env["WEBHOOK_URL"], "https://example.com/hook");
});

test("a saved secret wins over the same variable coming from the container, and says so", async () => {
  const path = await where();
  await (await loadSecretsFile(path, {}, silent)).set({ WEBHOOK_URL: "https://saved.example.com/hook" });

  const lines: string[] = [];
  const env: NodeJS.ProcessEnv = { WEBHOOK_URL: "https://from-env-file.example.com/hook" };
  await loadSecretsFile(path, env, createLogger("warn", (line) => lines.push(line)));

  assert.equal(env["WEBHOOK_URL"], "https://saved.example.com/hook");
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /WEBHOOK_URL/);
});

test("clearing a saved secret drops it from the environment and the file", async () => {
  const path = await where();
  const env: NodeJS.ProcessEnv = {};
  const secrets = await loadSecretsFile(path, env, silent);
  await secrets.set({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/x" });

  assert.equal(await secrets.clear("SLACK_WEBHOOK_URL"), true);

  assert.equal(env["SLACK_WEBHOOK_URL"], undefined);
  assert.equal(secrets.owns("SLACK_WEBHOOK_URL"), false);
  assert.doesNotMatch(await readFile(path, "utf8"), /SLACK_WEBHOOK_URL/);
});

test("clearing a saved secret falls back to the value the container supplied", async () => {
  const path = await where();
  await (await loadSecretsFile(path, {}, silent)).set({ WEBHOOK_URL: "https://saved.example.com/hook" });

  const env: NodeJS.ProcessEnv = { WEBHOOK_URL: "https://from-env-file.example.com/hook" };
  const secrets = await loadSecretsFile(path, env, createLogger("warn", () => {}));

  assert.equal(await secrets.clear("WEBHOOK_URL"), true);

  assert.equal(env["WEBHOOK_URL"], "https://from-env-file.example.com/hook");
});

test("clearing a variable the file does not own leaves the container's value alone", async () => {
  const env: NodeJS.ProcessEnv = { WEBHOOK_URL: "https://from-env-file.example.com/hook" };
  const secrets = await loadSecretsFile(await where(), env, silent);

  assert.equal(await secrets.clear("WEBHOOK_URL"), false);

  assert.equal(env["WEBHOOK_URL"], "https://from-env-file.example.com/hook");
});

test("a value that could forge a second entry, or carry nothing, is refused", async () => {
  const secrets = await loadSecretsFile(await where(), {}, silent);

  await assert.rejects(() => secrets.set({ WEBHOOK_URL: "https://example.com/hook\nTELEGRAM_BOT_TOKEN=stolen" }));
  await assert.rejects(() => secrets.set({ WEBHOOK_URL: "   " }));
  await assert.rejects(() => secrets.set({ WEBHOOK_URL: "x".repeat(4097) }));
});

test("a name that is not a variable name is refused, whatever the value", async () => {
  const secrets = await loadSecretsFile(await where(), {}, silent);

  await assert.rejects(() => secrets.set({ "webhook url": "https://example.com/hook" }));
  await assert.rejects(() => secrets.set({ "": "https://example.com/hook" }));
});

test("blank lines, comments and junk in the file are skipped rather than fatal", async () => {
  const path = await where();
  await writeFile(path, "# written by hand\n\nWEBHOOK_URL=https://example.com/hook\nnonsense\n", "utf8");

  const env: NodeJS.ProcessEnv = {};
  const secrets = await loadSecretsFile(path, env, silent);

  assert.equal(env["WEBHOOK_URL"], "https://example.com/hook");
  assert.equal(secrets.owns("WEBHOOK_URL"), true);
});
