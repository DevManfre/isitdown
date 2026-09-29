import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { readSettings, writeSettings } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

/**
 * Roadmap 15.11a's acceptance criterion 1: with the option absent or false,
 * booting the UI runtime must issue zero network requests to GHCR. `fetch` is
 * stubbed globally to throw on any call — the boot-time check in
 * `buildUiRuntime` calls `updateChecker.maybeRun`, and if that ever reached
 * the network with the setting off, this test would fail on the throw rather
 * than on an assertion.
 */
test("update check disabled by default: booting the UI runtime makes no GHCR request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-rt-updatecheck-"));
  const dbPath = join(dir, "isitdown.db");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`unexpected network request while the update check is off: ${String(input)}`);
  }) as typeof fetch;

  try {
    const runtime = await buildUiRuntime({ dbPath, env: {}, logger: silent });
    try {
      assert.equal(readSettings(runtime.db, silent).updateCheckEnabled, false);
      assert.equal(runtime.updateCheck.state().status, "unknown");
    } finally {
      await runtime.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicitly disabling it also makes no GHCR request on boot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-rt-updatecheck-off-"));
  const dbPath = join(dir, "isitdown.db");

  const seed = await buildUiRuntime({ dbPath, env: {}, logger: silent });
  writeSettings(seed.db, { updateCheckEnabled: false });
  await seed.close();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`unexpected network request while the update check is off: ${String(input)}`);
  }) as typeof fetch;

  try {
    const runtime = await buildUiRuntime({ dbPath, env: {}, logger: silent });
    await runtime.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
