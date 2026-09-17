import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentKey, isResolution } from "../../src/notifiers/incidentKey.ts";
import type { StatusChange } from "../../src/core/types.ts";

const at = "2026-08-19T14:32:07.000Z";
const base = { providerId: "github", currentStatus: "major_outage" as const, at };
const incident = { id: "i1", name: "", impact: "major", status: "investigating", updatedAt: at };

test("an incident keys on its own id, so three open ones are three alerts", () => {
  const first = incidentKey({ ...base, kind: "incident_opened", incident });
  const second = incidentKey({ ...base, kind: "incident_opened", incident: { ...incident, id: "i2" } });
  assert.notEqual(first, second);
  // The resolve has to name the alert the trigger opened.
  assert.equal(incidentKey({ ...base, kind: "incident_resolved", incident }), first);
  assert.equal(incidentKey({ ...base, kind: "incident_updated", incident }), first);
});

test("everything else keys on what it is about, so a worsening updates one alert", () => {
  const change: StatusChange = { ...base, kind: "status_change", previousStatus: "operational" };
  assert.equal(
    incidentKey(change),
    incidentKey({ ...change, currentStatus: "degraded", previousStatus: "major_outage" }),
  );
  assert.notEqual(incidentKey(change), incidentKey({ ...change, providerId: "cloudflare" }));
});

test("a component, a maintenance window and our own fetching each key on their own subject", () => {
  const keys = [
    incidentKey({ ...base, kind: "component_status_change", component: { id: "c1", name: "API" } }),
    incidentKey({
      ...base,
      kind: "maintenance_started",
      maintenance: { id: "m1", name: "", status: "scheduled", startsAt: at, endsAt: null, componentIds: [] },
    }),
    incidentKey({ ...base, kind: "monitoring_degraded", failureCount: 5 }),
    incidentKey({ ...base, kind: "status_change" }),
  ];
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
});

test("a shared failure keys on who it covers, whatever order they arrived in", () => {
  const one = incidentKey({
    ...base,
    kind: "correlated_outage",
    correlated: { providerIds: ["github", "cloudflare"], windowMinutes: 10 },
  });
  const other = incidentKey({
    ...base,
    kind: "correlated_outage",
    correlated: { providerIds: ["cloudflare", "github"], windowMinutes: 10 },
  });
  assert.equal(one, other);
});

test("only a genuine recovery closes an alert", () => {
  assert.equal(isResolution({ ...base, kind: "incident_resolved", incident }), true);
  assert.equal(
    isResolution({
      ...base,
      kind: "maintenance_ended",
      maintenance: { id: "m1", name: "", status: "completed", startsAt: at, endsAt: at, componentIds: [] },
    }),
    true,
  );
  assert.equal(isResolution({ ...base, kind: "status_change", currentStatus: "operational" }), true);
  assert.equal(isResolution({ ...base, kind: "status_change" }), false);
  assert.equal(isResolution({ ...base, kind: "incident_opened", incident }), false);
  // Our own fetching failing is not a recovery, and neither is a page caught
  // claiming to be fine.
  assert.equal(isResolution({ ...base, kind: "monitoring_degraded", failureCount: 5 }), false);
  assert.equal(
    isResolution({ ...base, kind: "silent_outage", crossCheck: { probeId: "p" } }),
    false,
  );
});
