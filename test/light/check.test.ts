import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The `check` command is only useful if its exit code is trustworthy — an
 * operator's CI reads that and nothing else — so the entrypoint is run as a
 * process rather than imported.
 */
async function check(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["src/light/check.ts", ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { code, stdout, stderr };
}

async function configFile(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-check-cli-"));
  const path = join(dir, "config.yml");
  await writeFile(path, body, "utf8");
  return path;
}

const VALID = `
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com

notifications:
  telegram:
    enabled: true
    botToken: "\${TELEGRAM_BOT_TOKEN}"
    chatId: "\${TELEGRAM_CHAT_ID}"
`;

test("a usable file exits zero and says what it read", async () => {
  const path = await configFile(VALID);

  const { code, stdout } = await check([path], { TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" });

  assert.equal(code, 0, stdout);
  assert.match(stdout, /is valid — 1 service \(1 enabled\), channels: telegram, file only, no provider read/);
});

test("a missing environment variable exits non-zero and names the variable", async () => {
  const path = await configFile(VALID);

  const { code, stderr } = await check([path]);

  assert.equal(code, 1);
  assert.match(stderr, /error: .*telegram channel is enabled but TELEGRAM_BOT_TOKEN is not set/);
  assert.match(stderr, /is not usable — 2 error\(s\), 0 warning\(s\)/);
});

test("the path can come from CONFIG_PATH, the way the container sets it", async () => {
  const path = await configFile(VALID);

  const { code, stdout } = await check([], {
    CONFIG_PATH: path,
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_CHAT_ID: "-100",
  });

  assert.equal(code, 0, stdout);
  assert.match(stdout, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is valid`));
});

test("an unknown option is a usage error, not a failed check", async () => {
  const { code, stderr } = await check(["--proof"]);

  assert.equal(code, 2, "2 keeps 'you typed it wrong' apart from 'the config is broken'");
  assert.match(stderr, /unknown option: --proof/);
  assert.match(stderr, /usage: node dist\/light\/check\.js/);
});

test("--help prints the usage and exits zero", async () => {
  const { code, stdout } = await check(["--help"]);

  assert.equal(code, 0);
  assert.match(stdout, /--probe/);
});
