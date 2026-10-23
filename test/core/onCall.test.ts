import { test } from "node:test";
import assert from "node:assert/strict";
import { onCallRecipientId, weekKey } from "../../src/core/onCall.ts";
import type { OnCallConfig } from "../../src/core/delivery.ts";

const config = (over: Partial<OnCallConfig> = {}): OnCallConfig => ({
  enabled: true,
  minSeverity: "major_outage",
  rotation: ["ana", "bo", "cy"],
  startsOn: "2026-10-05",
  ...over,
});

// 2026-10-05 is a Monday.
test("each UTC week is one recipient's, in turn, and the rotation then starts over", () => {
  const who = (iso: string) => onCallRecipientId(config(), new Date(iso));
  assert.equal(who("2026-10-05T00:00:00Z"), "ana");
  assert.equal(who("2026-10-11T23:59:59Z"), "ana", "Sunday still belongs to the same week");
  assert.equal(who("2026-10-12T00:00:00Z"), "bo");
  assert.equal(who("2026-10-19T12:00:00Z"), "cy");
  assert.equal(who("2026-10-26T12:00:00Z"), "ana");
});

test("startsOn may be any day of the first week", () => {
  assert.equal(onCallRecipientId(config({ startsOn: "2026-10-08" }), new Date("2026-10-06T00:00:00Z")), "ana");
});

test("before the start the rotation runs backwards instead of failing", () => {
  assert.equal(onCallRecipientId(config(), new Date("2026-09-28T00:00:00Z")), "cy");
});

test("nobody is on call when it is off or the rotation is empty", () => {
  assert.equal(onCallRecipientId(config({ enabled: false }), new Date("2026-10-05T00:00:00Z")), undefined);
  assert.equal(onCallRecipientId(config({ rotation: [] }), new Date("2026-10-05T00:00:00Z")), undefined);
});

test("an unreadable start date counts from the epoch instead of throwing", () => {
  assert.equal(onCallRecipientId(config({ startsOn: "2026-13-45" }), new Date("1970-01-05T00:00:00Z")), "ana");
});

test("weekKey is the Monday of the UTC week", () => {
  assert.equal(weekKey(new Date("2026-10-11T23:59:59Z")), "2026-10-05");
  assert.equal(weekKey(new Date("2026-10-12T00:00:00Z")), "2026-10-12");
});
