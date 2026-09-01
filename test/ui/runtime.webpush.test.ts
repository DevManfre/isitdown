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
    env: {},
    logger: silent,
  });
}

test("the webpush channel is seeded disabled and carries no settings of its own", async () => {
  const ui = await runtime();
  try {
    const config = await ui.configSource.load();
    const channel = config.channels.find((entry) => entry.id === "webpush");
    assert.ok(channel);
    assert.equal(channel.enabled, false);
    // Nothing to resolve from the environment any more: the key pair is the
    // server's own and is read straight from SQLite when the notifier is built.
    assert.deepEqual(channel.settings, {});
  } finally {
    await ui.close();
  }
});

test("the runtime's builder can construct the webpush channel the shared registry cannot", async () => {
  const ui = await runtime();
  try {
    const built = ui.buildNotifiers([{ id: "webpush", enabled: true, settings: {} }]);
    assert.deepEqual(
      built.map((notifier) => notifier.id),
      ["webpush"],
    );
  } finally {
    await ui.close();
  }
});

test("enabling the channel needs no configuration: the key pair is generated on first build", async () => {
  const ui = await runtime();
  try {
    // The whole point of dropping the two VAPID variables: a channel switched
    // on in the dashboard, with an empty environment, still builds a notifier
    // that can sign a push.
    assert.doesNotThrow(() => ui.buildNotifiers([{ id: "webpush", enabled: true, settings: {} }]));
    const stored = ui.db.prepare("SELECT value FROM settings WHERE key = 'vapidPrivateKey'").get() as {
      value: string;
    };
    assert.notEqual(stored.value, "");
  } finally {
    await ui.close();
  }
});
