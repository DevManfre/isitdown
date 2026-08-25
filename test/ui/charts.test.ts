import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { faviconCandidates } from "../../src/ui/web/lib/favicon.ts";
import {
  severity,
  statusColor,
  statusFill,
  statusLabelKey,
  statusMuted,
  trimToLatest,
} from "../../src/ui/web/lib/chartConfig.ts";

const STATUSES = ["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const;
const tokens = readFileSync(new URL("../../src/ui/web/css/tokens.css", import.meta.url), "utf8");

test("every status maps to its own colour token, declared in tokens.css", () => {
  const colours = STATUSES.map(statusColor);
  assert.equal(new Set(colours).size, STATUSES.length, "two statuses share a colour");
  for (const value of [...colours, ...STATUSES.map(statusFill)]) {
    const name = /var\((--[\w-]+)\)/.exec(value)?.[1];
    assert.ok(name !== undefined, `${value} is not a var()`);
    assert.ok(tokens.includes(`${name}:`), `${name} is not declared in tokens.css`);
  }
});

test("a worse status draws a taller bar, and unknown the shortest", () => {
  assert.ok(severity("operational") < severity("degraded"));
  assert.ok(severity("degraded") < severity("partial_outage"));
  assert.ok(severity("partial_outage") < severity("major_outage"));
  for (const status of ["operational", "degraded", "partial_outage", "major_outage"] as const) {
    assert.ok(severity("unknown") < severity(status), `unknown must sit below ${status}`);
  }
});

test("an unrecognised status resolves to unknown rather than throwing", () => {
  assert.equal(statusColor("banana"), statusColor("unknown"));
  assert.equal(statusLabelKey("banana"), statusLabelKey("unknown"));
});

test("only the unknown status is muted", () => {
  for (const status of STATUSES) {
    assert.equal(statusMuted(status), status === "unknown", `${status} muted mismatch`);
  }
  assert.equal(statusMuted("banana"), true, "an unrecognised status resolves to unknown, so it is muted too");
});

test("a painted shape uses the fill token, never the text colour token", () => {
  for (const status of STATUSES) {
    assert.notEqual(statusFill(status), statusColor(status), `${status} must not share a fill and text colour`);
  }
});

test("the favicon chain offers the origin first, then a fallback service", () => {
  assert.deepEqual(faviconCandidates("https://www.githubstatus.com/api"), [
    "https://www.githubstatus.com/favicon.ico",
    "https://icons.duckduckgo.com/ip3/www.githubstatus.com.ico",
  ]);
  assert.deepEqual(faviconCandidates("not a url"), []);
});

test("trimToLatest keeps the newest entries of a newest-first list", () => {
  assert.deepEqual(trimToLatest([5, 4, 3, 2, 1], 3), [5, 4, 3]);
});
