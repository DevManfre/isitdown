import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

async function runtime() {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-webpush-"));
  return buildUiRuntime({
    dbPath: join(dir, "test.db"),
    env: { VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" },
    logger: silent,
  });
}

test("the webpush channel is seeded, disabled, carrying only variable names", async () => {
  const ui = await runtime();
  try {
    const config = await ui.configSource.load();
    const channel = config.channels.find((entry) => entry.id === "webpush");
    assert.ok(channel);
    assert.equal(channel.enabled, false);
    assert.deepEqual(channel.settings, { publicKey: "BPub", privateKey: "kPriv" });
  } finally {
    await ui.close();
  }
});

test("the runtime's builder can construct the webpush channel the shared registry cannot", async () => {
  const ui = await runtime();
  try {
    const built = ui.buildNotifiers([
      { id: "webpush", enabled: true, settings: { publicKey: "BPub", privateKey: "kPriv" } },
    ]);
    assert.deepEqual(
      built.map((notifier) => notifier.id),
      ["webpush"],
    );
  } finally {
    await ui.close();
  }
});
