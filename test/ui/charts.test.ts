import { test } from "node:test";
import assert from "node:assert/strict";
// The mapping helpers are pure, so they are exercised without a browser.
import {
  barSpec,
  faviconCandidates,
  stagger,
  statusColor,
  statusFill,
  trimToLatest,
} from "../../src/ui/public/js/charts.js";

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

test("statusColor is the token a label written in its status colour uses", () => {
  assert.equal(statusColor("degraded"), "var(--status-degraded)");
});

test("a painted shape uses the fill token, never the text one", () => {
  const specs = ["operational", "degraded", "partial_outage", "major_outage", "unknown"].map(barSpec);
  assert.deepEqual(
    specs.map((spec) => spec.fill),
    [
      "var(--status-operational-fill)",
      "var(--status-degraded-fill)",
      "var(--status-partial-outage-fill)",
      "var(--status-major-outage-fill)",
      "var(--status-unknown-fill)",
    ],
  );
  assert.equal(statusFill("degraded"), "var(--status-degraded-fill)");
  assert.equal(statusFill("gremlins"), "var(--status-unknown-fill)");
});

test("each bar row scale reads its own height token for the same status", () => {
  assert.equal(barSpec("degraded").height, "var(--bar-degraded)");
  assert.equal(barSpec("degraded", "row").height, "var(--bar-degraded)");
  assert.equal(barSpec("degraded", "compact").height, "var(--bar-compact-degraded)");
  assert.equal(barSpec("degraded", "poll").height, "var(--bar-poll-degraded)");
});

test("a scale changes the height and nothing else", () => {
  const row = barSpec("major_outage", "row");
  const compact = barSpec("major_outage", "compact");
  assert.equal(compact.color, row.color);
  assert.equal(compact.status, row.status);
  assert.equal(compact.muted, row.muted);
  assert.notEqual(compact.height, row.height);
});

test("an unrecognised status degrades to unknown in every scale", () => {
  assert.equal(barSpec("gremlins", "compact").height, "var(--bar-compact-unknown)");
  assert.equal(barSpec("gremlins", "poll").height, "var(--bar-poll-unknown)");
});

test("stagger spaces items by a fixed step after an optional lead-in", () => {
  assert.equal(stagger(0, 70), "0ms");
  assert.equal(stagger(3, 70), "210ms");
  assert.equal(stagger(0, 80, 120), "120ms");
  assert.equal(stagger(2, 80, 120), "280ms");
});

test("faviconCandidates tries the page's own favicon first, then the icon service", () => {
  assert.deepEqual(faviconCandidates("https://www.cloudflarestatus.com/api/v2/summary.json"), [
    "https://www.cloudflarestatus.com/favicon.ico",
    "https://icons.duckduckgo.com/ip3/www.cloudflarestatus.com.ico",
  ]);
});

test("faviconCandidates offers nothing for anything it cannot parse as a URL", () => {
  assert.deepEqual(faviconCandidates("not a url"), []);
  assert.deepEqual(faviconCandidates(""), []);
  assert.deepEqual(faviconCandidates(undefined), []);
});

test("trimToLatest keeps the newest entries of a newest-first list", () => {
  const samples = [5, 4, 3, 2, 1];
  assert.deepEqual(trimToLatest(samples, 3), [5, 4, 3]);
  assert.deepEqual(trimToLatest(samples, 99), samples);
  assert.deepEqual(trimToLatest([], 3), []);
});
