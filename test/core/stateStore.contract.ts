import { test } from "node:test";
import assert from "node:assert/strict";
import { diff } from "../../src/core/diffEngine.ts";
import type { StateStore } from "../../src/core/stateStore.interface.ts";
import type { NormalizedStatus, OverallStatus } from "../../src/core/types.ts";

/**
 * Provider ids the contract exercises. A store whose schema requires the provider
 * to exist first (the UI edition's, where state hangs off a service row) seeds
 * these in its harness.
 */
export const CONTRACT_PROVIDER_IDS = ["github", "cloudflare", "nobody"] as const;

export interface StoreHarness {
  store: StateStore;
  /** Closes nothing; opens a second store over the same backing storage. */
  reopen: () => Promise<StateStore>;
}

const snap = (provider: string, overallStatus: OverallStatus): NormalizedStatus => ({
  provider,
  overallStatus,
  activeIncidents: [
    {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "investigating",
      updatedAt: "2026-08-19T14:00:00.000Z",
    },
  ],
  components: [],
  fetchedAt: "2026-08-19T14:05:00.000Z",
});

/**
 * The behaviour every StateStore implementation must have. Run unchanged
 * against the Light edition's file store and the UI edition's SQLite store:
 * that is what makes them interchangeable rather than merely similar, and it is
 * where restart safety is pinned down.
 */
export function runStateStoreContract(name: string, makeStore: () => Promise<StoreHarness>): void {
  test(`${name}: an unseen provider reads as a zeroed baseline`, async () => {
    const { store } = await makeStore();
    assert.deepEqual(await store.getState("nobody"), {
      last: null,
      failureCount: 0,
      degradedNotified: false,
    });
    await store.close();
  });

  test(`${name}: a saved status round-trips field for field`, async () => {
    const { store } = await makeStore();
    const saved = snap("github", "degraded");
    await store.saveStatus(saved);
    assert.deepEqual((await store.getState("github")).last, saved);
    await store.close();
  });

  test(`${name}: saving twice keeps the newer status`, async () => {
    const { store } = await makeStore();
    await store.saveStatus(snap("github", "degraded"));
    await store.saveStatus({ ...snap("github", "major_outage"), fetchedAt: "2026-08-19T14:10:00.000Z" });
    const state = await store.getState("github");
    assert.equal(state.last?.overallStatus, "major_outage");
    assert.equal(state.last?.fetchedAt, "2026-08-19T14:10:00.000Z");
    await store.close();
  });

  test(`${name}: providers are isolated from each other`, async () => {
    const { store } = await makeStore();
    await store.saveStatus(snap("github", "degraded"));
    assert.equal((await store.getState("cloudflare")).last, null);
    await store.close();
  });

  test(`${name}: recordFailure counts up and returns the new count`, async () => {
    const { store } = await makeStore();
    assert.equal(await store.recordFailure("github"), 1);
    assert.equal(await store.recordFailure("github"), 2);
    assert.equal(await store.recordFailure("github"), 3);
    assert.equal((await store.getState("github")).failureCount, 3);
    await store.close();
  });

  test(`${name}: clearFailures resets the count without touching the status`, async () => {
    const { store } = await makeStore();
    await store.saveStatus(snap("github", "degraded"));
    await store.recordFailure("github");
    await store.clearFailures("github");
    const state = await store.getState("github");
    assert.equal(state.failureCount, 0);
    assert.equal(state.last?.overallStatus, "degraded");
    await store.close();
  });

  test(`${name}: a failure never overwrites the last known status`, async () => {
    const { store } = await makeStore();
    const saved = snap("github", "degraded");
    await store.saveStatus(saved);
    await store.recordFailure("github");
    await store.recordFailure("github");
    assert.deepEqual((await store.getState("github")).last, saved);
    await store.close();
  });

  test(`${name}: the degradedNotified flag persists both ways`, async () => {
    const { store } = await makeStore();
    await store.setDegradedNotified("github", true);
    assert.equal((await store.getState("github")).degradedNotified, true);
    await store.setDegradedNotified("github", false);
    assert.equal((await store.getState("github")).degradedNotified, false);
    await store.close();
  });

  test(`${name}: failure bookkeeping survives a reopen`, async () => {
    const { store, reopen } = await makeStore();
    await store.recordFailure("github");
    await store.recordFailure("github");
    await store.setDegradedNotified("github", true);
    await store.close();

    const reopened = await reopen();
    const state = await reopened.getState("github");
    assert.equal(state.failureCount, 2);
    assert.equal(state.degradedNotified, true);
    await reopened.close();
  });

  test(`${name}: a restart does not make the diff engine fire`, async () => {
    const { store, reopen } = await makeStore();
    const saved = snap("github", "degraded");
    await store.saveStatus(saved);
    await store.close();

    const reopened = await reopen();
    const state = await reopened.getState("github");
    assert.deepEqual(
      diff(state.last, saved),
      [],
      "reloaded state must compare equal, or every restart re-notifies everything",
    );
    await reopened.close();
  });

  test(`${name}: close is safe to call twice`, async () => {
    const { store } = await makeStore();
    await store.close();
    await store.close();
  });
}
