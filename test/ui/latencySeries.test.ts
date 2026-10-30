import { test } from "node:test";
import assert from "node:assert/strict";
import { latencySeries, latencySummary, percentile } from "../../src/ui/latencySeries.ts";

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 30, 0, minute)).toISOString();
const HOUR = 60 * 60 * 1000;

test("a percentile is the nearest-rank value, so it is always a reading that happened", () => {
  const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  assert.equal(percentile(sorted, 50), 500);
  assert.equal(percentile(sorted, 95), 1000);
  assert.equal(percentile([42], 95), 42);
});

test("samples are grouped into the bucket they fall in, oldest first, with their own p50 and p95", () => {
  const points = latencySeries(
    [
      { observedAt: at(130), latencyMs: 900 },
      { observedAt: at(5), latencyMs: 100 },
      { observedAt: at(10), latencyMs: 300 },
      { observedAt: at(20), latencyMs: 200 },
    ],
    HOUR,
  );

  assert.deepEqual(points, [
    { at: at(0), p50: 200, p95: 300, samples: 3 },
    { at: at(120), p50: 900, p95: 900, samples: 1 },
  ]);
});

test("a bucket nothing was read in is absent rather than drawn as zero", () => {
  const points = latencySeries([{ observedAt: at(5), latencyMs: 100 }, { observedAt: at(300), latencyMs: 100 }], HOUR);
  assert.equal(points.length, 2);
});

test("the summary counts the readings over the threshold, and null threshold counts none", () => {
  const samples = [100, 200, 900, 1200].map((latencyMs, index) => ({ observedAt: at(index), latencyMs }));

  assert.deepEqual(latencySummary(samples, 800), { p50: 200, p95: 1200, samples: 4, overSlow: 2 });
  assert.equal(latencySummary(samples, null)?.overSlow, null);
  assert.equal(latencySummary([], 800), null);
});
