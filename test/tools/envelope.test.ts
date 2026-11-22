import { test } from "node:test";
import assert from "node:assert/strict";
import { cyclesFor, median, monthlyGrowth, render } from "../../tools/envelope.mjs";

test("a small fleet runs enough cycles to add the samples asked for", () => {
  assert.equal(cyclesFor(10, 2000), 200);
  assert.equal(cyclesFor(10, 5000), 500);
});

test("a large fleet still runs a hundred cycles, so memory has settled when it is read", () => {
  assert.equal(cyclesFor(100, 2000), 100);
  assert.equal(cyclesFor(500, 2000), 100);
});

test("growth is bytes per provider per cycle, times a month of 3-minute cycles", () => {
  // 10 providers × 100 cycles adding 100,000 bytes: 100 bytes a sample,
  // 14,400 cycles in 30 days at the default interval.
  assert.equal(monthlyGrowth(100_000, 10, 100), 1_440_000);
});

test("the median of an even count is the mean of the middle two, whatever the order", () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([40, 10, 30, 20]), 25);
});

test("the table names its measuring conditions and leaves the Light edition's database empty", () => {
  const markdown = render(
    [
      { edition: "Light", providers: 10, startupMs: 205, rssBytes: 117 * 1024 * 1024, cpuMsPerCycle: 20, cycleMs: 13, startBytes: null, monthlyBytes: null },
      { edition: "UI", providers: 10, startupMs: 18_300, rssBytes: 200 * 1024 * 1024, cpuMsPerCycle: 24, cycleMs: 36, startBytes: 30 * 1024 * 1024, monthlyBytes: 3.4 * 1024 * 1024 },
    ],
    { date: "2026-11-21", version: "v2.46.1", node: "26.0.0", machine: "Test CPU (8 threads), 16 GB RAM", samples: 2000 },
  );
  assert.match(markdown, /^Measured on 2026-11-21, IsItDown v2\.46\.1, Node 26\.0\.0, Test CPU/);
  assert.match(markdown, /\| Light \| 10 \| 205 ms \| 117 MB \| 20 ms \| 13 ms \| — \| — \(state file\) \|/);
  assert.match(markdown, /\| UI \| 10 \| 18\.3 s \| 200 MB \| 24 ms \| 36 ms \| 30\.0 MB \| 3\.4 MB \|/);
});
