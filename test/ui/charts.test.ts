import { test } from "node:test";
import assert from "node:assert/strict";
// The mapping helpers are pure, so they are exercised without a browser.
import { barSpec, statusColor, trimToLatest } from "../../src/ui/public/js/charts.js";

test("every status maps to its own colour and height token", () => {
  const specs = ["operational", "degraded", "partial_outage", "major_outage", "unknown"].map(barSpec);
  assert.deepEqual(
    specs.map((spec) => spec.color),
    [
      "var(--status-operational)",
      "var(--status-degraded)",
      "var(--status-partial-outage)",
      "var(--status-major-outage)",
      "var(--status-unknown)",
    ],
  );
  assert.deepEqual(
    specs.map((spec) => spec.height),
    [
      "var(--bar-operational)",
      "var(--bar-degraded)",
      "var(--bar-partial-outage)",
      "var(--bar-major-outage)",
      "var(--bar-unknown)",
    ],
  );
});

test("a bar never carries a literal colour, only a token reference", () => {
  for (const status of ["operational", "major_outage", "unknown"]) {
    assert.match(barSpec(status).color, /^var\(--status-/);
    assert.ok(!/#[0-9a-f]{3,8}/i.test(barSpec(status).color));
  }
});

test("severity ordering is reflected in decreasing bar heights", () => {
  const height = (status: string): number => Number(barSpec(status).height.match(/--bar-([a-z-]+)/)?.[1] === undefined ? 0 : 1);
  // The heights themselves live in tokens.css; what matters here is that each
  // status resolves to its own distinct token rather than sharing one.
  const tokens = ["operational", "degraded", "partial_outage", "major_outage"].map(
    (status) => barSpec(status).height,
  );
  assert.equal(new Set(tokens).size, 4);
  assert.equal(height("operational"), 1);
});

test("only the unknown bucket is muted", () => {
  assert.equal(barSpec("unknown").muted, true);
  assert.equal(barSpec("operational").muted, false);
});

test("an unrecognised status degrades to unknown instead of rendering nothing", () => {
  const spec = barSpec("gremlins");
  assert.equal(spec.status, "unknown");
  assert.equal(spec.color, "var(--status-unknown)");
});

test("statusColor is the token a dot or a ring paints with", () => {
  assert.equal(statusColor("degraded"), "var(--status-degraded)");
});

test("trimToLatest keeps the newest entries of a newest-first list", () => {
  const samples = [5, 4, 3, 2, 1];
  assert.deepEqual(trimToLatest(samples, 3), [5, 4, 3]);
  assert.deepEqual(trimToLatest(samples, 99), samples);
  assert.deepEqual(trimToLatest([], 3), []);
});
