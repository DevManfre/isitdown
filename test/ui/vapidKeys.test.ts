import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../src/core/logger.ts";
import { migrate } from "../../src/ui/db/migrate.ts";
import { seedDefaults } from "../../src/ui/db/seed.ts";
import { ensureVapidKeys, isVapidPublicKey } from "../../src/ui/vapidKeys.ts";

const silent = createLogger("error", () => {});

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seedDefaults(db);
  return db;
}

test("the first call generates a usable pair and every later call returns the same one", () => {
  const db = database();
  const first = ensureVapidKeys(db, silent);
  assert.ok(isVapidPublicKey(first.publicKey), "the generated public key must be a P-256 point");
  assert.notEqual(first.privateKey, "");

  // Stability is the whole point: a pair that changed per call would silently
  // invalidate every subscription a browser already registered with it.
  assert.deepEqual(ensureVapidKeys(db, silent), first);
  assert.deepEqual(ensureVapidKeys(database(), silent).publicKey === first.publicKey, false);
});

test("an unusable stored key is replaced rather than served", () => {
  const db = database();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  upsert.run("vapidPublicKey", "A".repeat(90));
  upsert.run("vapidPrivateKey", "whatever");

  const warnings: string[] = [];
  const keys = ensureVapidKeys(db, createLogger("warn", (line) => warnings.push(line)));
  assert.ok(isVapidPublicKey(keys.publicKey));
  assert.notEqual(keys.publicKey, "A".repeat(90));
  // Regenerating drops every existing subscription, so it is never silent.
  assert.equal(warnings.length, 1);
});

test("a long base64url run that only looks key-shaped is not a public key", () => {
  // 90 "A" characters decode to 67 zero bytes, not the 65 bytes starting 0x04
  // a real VAPID public key is — a character-set check alone would pass it.
  assert.equal(isVapidPublicKey("A".repeat(90)), false);
  assert.equal(isVapidPublicKey(""), false);
});
