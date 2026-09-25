import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStatus, initialState, MAX_CHANGES } from "../../src/cli/watch/state.ts";
import type { StatusResponse } from "../../src/cli/watch/schema.ts";

function status(providers: StatusResponse["providers"]): StatusResponse {
  return { providers, serverNow: "2026-01-01T00:00:00.000Z" };
}

test("a fresh provider is seeded with since = now", () => {
  const state = applyStatus(
    initialState(),
    status([{ id: "github", name: "GitHub", enabled: true, overallStatus: "operational", fetchedAt: "2026-01-01T00:00:00.000Z" }]),
    "2026-01-01T00:05:00.000Z",
  );
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0]?.since, "2026-01-01T00:05:00.000Z");
  assert.equal(state.providers[0]?.status, "operational");
  assert.equal(state.changes.length, 0);
});

test("a later read with no reported change keeps the previous since", () => {
  const first = applyStatus(
    initialState(),
    status([{ id: "github", name: "GitHub", enabled: true, overallStatus: "operational", fetchedAt: "t1" }]),
    "2026-01-01T00:05:00.000Z",
  );
  const second = applyStatus(
    first,
    status([{ id: "github", name: "GitHub", enabled: true, overallStatus: "operational", fetchedAt: "t2" }]),
    "2026-01-01T00:10:00.000Z",
  );
  assert.equal(second.providers[0]?.since, "2026-01-01T00:05:00.000Z");
  assert.equal(second.providers[0]?.fetchedAt, "t2");
  assert.equal(second.changes.length, 0, "an unchanged status is not queued");
});

test("a provider named in changedProviderIds moves since to now and is queued", () => {
  const first = applyStatus(
    initialState(),
    status([{ id: "github", name: "GitHub", enabled: true, overallStatus: "operational", fetchedAt: "t1" }]),
    "2026-01-01T00:05:00.000Z",
  );
  const second = applyStatus(
    first,
    status([{ id: "github", name: "GitHub", enabled: true, overallStatus: "major_outage", fetchedAt: "t2" }]),
    "2026-01-01T00:10:00.000Z",
    new Set(["github"]),
  );
  assert.equal(second.providers[0]?.since, "2026-01-01T00:10:00.000Z");
  assert.equal(second.providers[0]?.status, "major_outage");
  assert.equal(second.changes.length, 1);
  assert.deepEqual(second.changes[0], {
    at: "2026-01-01T00:10:00.000Z",
    providerId: "github",
    providerName: "GitHub",
    status: "major_outage",
  });
});

test("the change queue keeps only the most recent MAX_CHANGES, newest first", () => {
  let state = applyStatus(
    initialState(),
    status([{ id: "p", name: "P", enabled: true, overallStatus: "operational", fetchedAt: null }]),
    "t0",
  );
  for (let i = 0; i < MAX_CHANGES + 5; i++) {
    state = applyStatus(
      state,
      status([{ id: "p", name: "P", enabled: true, overallStatus: i % 2 === 0 ? "degraded" : "operational", fetchedAt: null }]),
      `t${i + 1}`,
      new Set(["p"]),
    );
  }
  assert.equal(state.changes.length, MAX_CHANGES);
  assert.equal(state.changes[0]?.at, `t${MAX_CHANGES + 5}`);
});
