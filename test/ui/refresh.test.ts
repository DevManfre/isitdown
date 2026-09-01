import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldHoldRefresh } from "../../src/ui/web/lib/holdRefresh.ts";

const page = (over: Partial<Parameters<typeof shouldHoldRefresh>[0]> = {}) => ({
  hidden: false, dialogOpen: false, editing: false, ...over,
});

test("an idle visible page may refresh", () => {
  assert.equal(shouldHoldRefresh(page()), false);
});

test("a hidden tab holds: it has nothing to show", () => {
  assert.equal(shouldHoldRefresh(page({ hidden: true })), true);
});

test("an open dialog holds: a repaint would discard what is being edited", () => {
  assert.equal(shouldHoldRefresh(page({ dialogOpen: true })), true);
});

test("a focused field holds, for the same reason", () => {
  assert.equal(shouldHoldRefresh(page({ editing: true })), true);
});

// How long the dashboard waits before re-asking /status, and on whose clock
// the countdown is measured. A flat 30s left the countdown sitting at "0s" for
// up to half a minute after every cycle; trusting the browser's clock left it
// there indefinitely whenever the container's had drifted.
import { msUntilNextPoll, statusRefetchDelay } from "../../src/ui/web/lib/statusRefetch.ts";

test("with no deadline to wait for, the idle 30s rhythm applies", () => {
  assert.equal(statusRefetchDelay(null), 30_000);
});

test("a deadline further away than the idle rhythm does not shorten it", () => {
  assert.equal(statusRefetchDelay(300_000), 30_000);
});

test("a deadline inside the idle rhythm is asked for when it expires, not 30s later", () => {
  assert.equal(statusRefetchDelay(12_000), 13_000);
});

test("an expired deadline is re-asked promptly, instead of the countdown sitting at zero", () => {
  assert.equal(statusRefetchDelay(-40_000), 3_000);
});

test("a deadline about to expire never asks faster than once a second", () => {
  assert.equal(statusRefetchDelay(200), 1_200);
  assert.ok(statusRefetchDelay(1) >= 1_000);
});

const serverAt = (iso: string, offsetSeconds: number): string =>
  new Date(Date.parse(iso) + offsetSeconds * 1000).toISOString();

const DEADLINE = "2026-08-26T12:00:00.000Z";

test("with the clocks agreeing, the remaining time is the plain difference", () => {
  const landed = Date.parse(serverAt(DEADLINE, -120));
  assert.equal(
    msUntilNextPoll({ nextPollAt: DEADLINE, serverNow: serverAt(DEADLINE, -120) }, landed, landed),
    120_000,
  );
});

// The whole point: a browser running ten minutes ahead of the container would
// otherwise read a deadline two minutes out as eight minutes expired, and the
// countdown would sit at "0s" until the host clock resynced.
test("a browser clock running ahead of the server's does not expire the deadline", () => {
  const serverNow = serverAt(DEADLINE, -120);
  const landed = Date.parse(serverNow) + 600_000;
  assert.equal(msUntilNextPoll({ nextPollAt: DEADLINE, serverNow }, landed, landed), 120_000);
});

test("a browser clock running behind the server's does not stretch the countdown either", () => {
  const serverNow = serverAt(DEADLINE, -120);
  const landed = Date.parse(serverNow) - 600_000;
  assert.equal(msUntilNextPoll({ nextPollAt: DEADLINE, serverNow }, landed, landed), 120_000);
});

test("the countdown still runs down between refetches, on the corrected clock", () => {
  const serverNow = serverAt(DEADLINE, -120);
  const landed = Date.parse(serverNow) + 600_000;
  assert.equal(msUntilNextPoll({ nextPollAt: DEADLINE, serverNow }, landed, landed + 30_000), 90_000);
});

test("without serverNow the browser's clock is trusted, as it was before", () => {
  const landed = Date.parse(DEADLINE) - 45_000;
  assert.equal(msUntilNextPoll({ nextPollAt: DEADLINE }, landed, landed), 45_000);
});

test("no deadline, unparseable data or no response yet all report nothing to count down", () => {
  assert.equal(msUntilNextPoll({ nextPollAt: null, serverNow: DEADLINE }, 1, 1), null);
  assert.equal(msUntilNextPoll({ nextPollAt: "not a date" }, 1, 1), null);
  assert.equal(msUntilNextPoll(undefined, 0, 1), null);
});

test("an unparseable serverNow falls back to the browser's clock rather than to NaN", () => {
  const landed = Date.parse(DEADLINE) - 45_000;
  assert.equal(msUntilNextPoll({ nextPollAt: DEADLINE, serverNow: "nope" }, landed, landed), 45_000);
});
