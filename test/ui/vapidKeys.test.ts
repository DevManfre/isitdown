import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVapidEnv } from "../../scripts/vapidKeys.ts";

test("the generator prints a pasteable pair of environment lines", () => {
  const output = formatVapidEnv({ publicKey: "BPub", privateKey: "kPriv" });
  assert.equal(output, "VAPID_PUBLIC_KEY=BPub\nVAPID_PRIVATE_KEY=kPriv");
});
