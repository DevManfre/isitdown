import { test } from "node:test";
import assert from "node:assert/strict";
import { latencyBand, LATENCY_WINDOW, MIN_LATENCY_SAMPLES, pushLatency } from "../../src/core/latency.ts";

/** A page that answers in about 200 ms, with ordinary jitter. */
const usual = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => 180 + (index % 5) * 10);

test("too few readings describe no band at all", () => {
  assert.equal(latencyBand(usual(MIN_LATENCY_SAMPLES - 1)), null);
  assert.notEqual(latencyBand(usual(MIN_LATENCY_SAMPLES)), null);
});

test("the band sits on the median, so one wild outlier moves neither it nor the line", () => {
  const calm = latencyBand(usual(30));
  const withSpike = latencyBand([...usual(29), 9000]);
  assert.equal(calm?.medianMs, 200);
  assert.equal(withSpike?.medianMs, 200);
  assert.equal(withSpike?.thresholdMs, calm?.thresholdMs);
});

test("a page that barely varies still needs a second of difference to stand out", () => {
  // MAD zero: on its own the band would call 61 ms against 60 ms an anomaly.
  const band = latencyBand(Array.from({ length: 30 }, () => 60));
  assert.equal(band?.medianMs, 60);
  assert.equal(band?.thresholdMs, 1060);
});

test("a page that is usually slow is judged against itself, not against a fixed second", () => {
  const band = latencyBand(Array.from({ length: 30 }, (_, index) => 2000 + (index % 3) * 100));
  assert.ok(band !== null);
  // Three times its own median, not "anything over a second".
  assert.ok(band.thresholdMs >= 3 * band.medianMs);
});

test("readings that are not a duration are left out rather than counted", () => {
  assert.equal(latencyBand([...usual(MIN_LATENCY_SAMPLES - 1), Number.NaN, -1]), null);
});

test("the window keeps the most recent readings and drops the oldest", () => {
  let window: number[] = [];
  for (let index = 0; index < LATENCY_WINDOW + 5; index += 1) window = pushLatency(window, index);
  assert.equal(window.length, LATENCY_WINDOW);
  assert.equal(window[0], 5);
  assert.equal(window.at(-1), LATENCY_WINDOW + 4);
});
