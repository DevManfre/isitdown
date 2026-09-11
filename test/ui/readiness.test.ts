import { test } from "node:test";
import assert from "node:assert/strict";
import { readiness } from "../../src/ui/readiness.ts";

const now = new Date("2026-09-10T12:00:00.000Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

test("a fresh cycle where every provider answered is ready", () => {
  const report = readiness({
    cycle: { finishedAt: ago(30), providers: 3, failed: 0 },
    providerCount: 3,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "ready");
  assert.equal(report.reason, undefined);
  assert.equal(report.ageSeconds, 30);
  assert.equal(report.staleAfterSeconds, 540, "three intervals of slack");
});

test("a cycle where some providers failed is still ready — one bad provider is not an outage of ours", () => {
  const report = readiness({
    cycle: { finishedAt: ago(30), providers: 3, failed: 1 },
    providerCount: 3,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "ready");
  assert.equal(report.failed, 1);
});

test("no cycle yet is not ready, and says so rather than reporting an age", () => {
  const report = readiness({ cycle: null, providerCount: 3, intervalMinutes: 3, now });

  assert.equal(report.status, "not_ready");
  assert.equal(report.lastCycleAt, null);
  assert.equal(report.ageSeconds, null);
  assert.match(report.reason ?? "", /no poll cycle/);
});

test("a cycle older than three intervals is not ready, and the reason carries both figures", () => {
  const report = readiness({
    cycle: { finishedAt: ago(600), providers: 3, failed: 0 },
    providerCount: 3,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "not_ready");
  assert.match(report.reason ?? "", /600s/);
  assert.match(report.reason ?? "", /540s/);
});

test("a cycle exactly at the limit is still ready — the window is inclusive", () => {
  const report = readiness({
    cycle: { finishedAt: ago(540), providers: 3, failed: 0 },
    providerCount: 3,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "ready");
});

test("a cycle in which every provider failed is not ready: nothing was read", () => {
  const report = readiness({
    cycle: { finishedAt: ago(10), providers: 2, failed: 2 },
    providerCount: 2,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "not_ready");
  assert.match(report.reason ?? "", /every provider failed/);
});

test("a cycle with nothing to poll is ready — an empty fleet is a configuration, not a failure", () => {
  const report = readiness({
    cycle: { finishedAt: ago(10), providers: 0, failed: 0 },
    providerCount: 0,
    intervalMinutes: 3,
    now,
  });

  assert.equal(report.status, "ready");
});
