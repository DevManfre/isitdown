import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../../src/ui/db/migrate.ts";
import { createSqlitePushSubscriptionStore } from "../../src/ui/sqlitePushSubscriptionStore.ts";

function store() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return createSqlitePushSubscriptionStore(db);
}

const chrome = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };

test("a saved subscription comes back for the notifier to deliver to", async () => {
  const subscriptions = store();
  subscriptions.save(chrome, "Chrome · Windows");
  assert.deepEqual(await subscriptions.list(), [chrome]);
});

test("re-subscribing the same browser updates the device instead of duplicating it", async () => {
  const subscriptions = store();
  subscriptions.save(chrome, "Chrome · Windows");
  subscriptions.save({ ...chrome, keys: { p256dh: "p2", auth: "a2" } }, "Chrome · Windows");

  const all = await subscriptions.list();
  assert.equal(all.length, 1);
  assert.deepEqual(all[0]!.keys, { p256dh: "p2", auth: "a2" });
  assert.equal(subscriptions.listDevices().length, 1);
});

test("a device is listed with its label and can be removed by id", async () => {
  const subscriptions = store();
  subscriptions.save(chrome, "Chrome · Windows");

  const [device] = subscriptions.listDevices();
  assert.equal(device?.label, "Chrome · Windows");
  assert.equal(subscriptions.remove(device!.id), true);
  assert.deepEqual(await subscriptions.list(), []);
  assert.equal(subscriptions.remove(device!.id), false);
});

test("pruning drops the device the push service said was gone", async () => {
  const subscriptions = store();
  subscriptions.save(chrome, "Chrome · Windows");
  subscriptions.save({ endpoint: "https://push.example/def", keys: { p256dh: "q", auth: "b" } }, "Firefox · Linux");

  await subscriptions.prune("https://push.example/abc");

  assert.deepEqual(
    (await subscriptions.list()).map((entry) => entry.endpoint),
    ["https://push.example/def"],
  );
});

test("a created_at tie is broken by id, not by insertion order", async (t) => {
  // sha256("https://push.example/def") = ab0238c9... sorts BEFORE
  // sha256("https://push.example/abc") = f7a263f8... even though "abc" (the
  // `chrome` subscription) is saved first below. That inversion is the
  // whole point: it is what lets this test fail if the id tiebreaker is
  // ever dropped from the ORDER BY. Do not swap in other endpoint strings
  // without checking their digests order the same way.
  t.mock.timers.enable({ apis: ["Date"] });
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const subscriptions = createSqlitePushSubscriptionStore(db);
  const firefox = { endpoint: "https://push.example/def", keys: { p256dh: "q", auth: "b" } };

  subscriptions.save(chrome, "Chrome · Windows"); // inserted first
  subscriptions.save(firefox, "Firefox · Linux"); // inserted second, sorts first by id

  const timestamps = db.prepare("SELECT DISTINCT created_at FROM push_subscriptions").all() as {
    created_at: string;
  }[];
  assert.equal(timestamps.length, 1, "both saves must land on the same created_at to exercise the tiebreaker");

  assert.deepEqual(
    subscriptions.listDevices().map((device) => device.label),
    ["Firefox · Linux", "Chrome · Windows"],
    "the id, not insertion order, must decide a created_at tie",
  );
  assert.deepEqual(
    (await subscriptions.list()).map((entry) => entry.endpoint),
    ["https://push.example/def", "https://push.example/abc"],
    "the id, not insertion order, must decide a created_at tie",
  );
});
