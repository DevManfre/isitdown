import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotifiers } from "../../src/notifiers/index.ts";
import type { ChannelConfig } from "../../src/core/configSource.interface.ts";

const telegram: ChannelConfig = {
  id: "telegram",
  enabled: true,
  settings: { botToken: "123:ABC", chatId: "-100" },
};
const webhook: ChannelConfig = {
  id: "webhook",
  enabled: true,
  settings: { url: "https://hooks.example/x" },
};

test("only enabled channels are built", () => {
  const built = buildNotifiers([telegram, { ...webhook, enabled: false }]);
  assert.deepEqual(
    built.map((notifier) => notifier.id),
    ["telegram"],
  );
});

test("both channels can be built together", () => {
  assert.equal(buildNotifiers([telegram, webhook]).length, 2);
});

test("no channels means no notifiers rather than an error", () => {
  assert.deepEqual(buildNotifiers([]), []);
});

test("an unknown channel id is reported by name", () => {
  assert.throws(() => buildNotifiers([{ id: "carrier-pigeon", enabled: true, settings: {} }]), /carrier-pigeon/);
});

test("a disabled channel with unusable settings is still skipped, not validated", () => {
  assert.doesNotThrow(() => buildNotifiers([{ id: "telegram", enabled: false, settings: {} }]));
});
