import { test } from "node:test";
import assert from "node:assert/strict";
// Both helpers are pure, so the refresh policy is exercised without a browser.
import { entryAnimationPlan, shouldHoldRefresh, snapshot } from "../../src/ui/public/js/refresh.js";

const status = {
  providers: [{ id: "github", status: "operational", activeIncidents: [] }],
  nextPollAt: "2026-08-20T10:05:00.000Z",
};
const config = { channels: [{ id: "telegram", enabled: true }] };

test("an unchanged payload produces an unchanged fingerprint", () => {
  assert.equal(
    snapshot(status, config),
    snapshot(structuredClone(status), structuredClone(config)),
  );
});

test("a status change, a config change or a later poll each change the fingerprint", () => {
  const base = snapshot(status, config);
  const degraded = structuredClone(status);
  degraded.providers[0]!.status = "degraded";
  assert.notEqual(snapshot(degraded, config), base);

  const polled = structuredClone(status);
  polled.nextPollAt = "2026-08-20T10:10:00.000Z";
  assert.notEqual(snapshot(polled, config), base);

  assert.notEqual(snapshot(status, { channels: [{ id: "telegram", enabled: false }] }), base);
});

test("a missing payload is still fingerprintable", () => {
  assert.equal(snapshot(undefined, undefined), snapshot(undefined, undefined));
  assert.notEqual(snapshot(undefined, undefined), snapshot(status, config));
});

test("a refresh only goes ahead on a visible page with nothing being edited", () => {
  assert.equal(shouldHoldRefresh({ hidden: false, dialogOpen: false, editing: false }), false);
  assert.equal(shouldHoldRefresh({ hidden: true, dialogOpen: false, editing: false }), true);
  assert.equal(shouldHoldRefresh({ hidden: false, dialogOpen: true, editing: false }), true);
  assert.equal(shouldHoldRefresh({ hidden: false, dialogOpen: false, editing: true }), true);
});

test("a repaint that must not replay silences its own nodes, never the container", () => {
  // The gate on the container is what a later interaction — a filter rebuilding
  // its list — needs to animate the nodes it inserts, so a quiet repaint marks
  // what it swaps in instead of taking the gate away.
  assert.deepEqual(entryAnimationPlan("providers||en|nocturne", "providers||en|nocturne"), {
    replay: false,
    quiet: true,
  });
});

test("a new view, language or theme replays the entry animations", () => {
  assert.deepEqual(entryAnimationPlan("providers||en|nocturne", "incidents||en|nocturne"), {
    replay: true,
    quiet: false,
  });
  assert.deepEqual(entryAnimationPlan("providers||en|nocturne", "providers||it|nocturne"), {
    replay: true,
    quiet: false,
  });
  assert.deepEqual(entryAnimationPlan(undefined, "overview||en|nocturne"), {
    replay: true,
    quiet: false,
  });
});
