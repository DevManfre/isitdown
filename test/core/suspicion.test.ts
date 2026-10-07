import { test } from "node:test";
import assert from "node:assert/strict";
import { openSuspicion } from "../../src/core/suspicion.ts";
import type { ProviderRuntimeState } from "../../src/core/stateStore.interface.ts";
import type { Incident, OverallStatus, Suspicion } from "../../src/core/types.ts";

const state = (
  page: OverallStatus | null,
  suspicions: Suspicion[],
  incidents: Incident[] = [],
): ProviderRuntimeState => ({
  last:
    page === null
      ? null
      : { provider: "github", overallStatus: page, activeIncidents: incidents, components: [], maintenances: [], fetchedAt: "2026-08-19T14:00:00.000Z" },
  failureCount: 0,
  degradedNotified: false,
  notifyBaseline: null,
  pending: null,
  suspicions,
});

const suspect = (status: OverallStatus, probeId: string, since: string): Suspicion => ({ status, probeId, since });

test("no suspicion reads as none", () => {
  assert.equal(openSuspicion(state("operational", [])), null);
});

test("an operational page with one accusing probe is suspected of that probe's reading", () => {
  const one = suspect("major_outage", "api", "2026-08-19T14:00:00.000Z");
  assert.deepEqual(openSuspicion(state("operational", [one])), one);
});

test("among several probes the worst reading wins, and among equals the oldest", () => {
  const minor = suspect("degraded", "a", "2026-08-19T13:00:00.000Z");
  const newer = suspect("major_outage", "b", "2026-08-19T14:00:00.000Z");
  const older = suspect("major_outage", "c", "2026-08-19T13:30:00.000Z");
  assert.deepEqual(openSuspicion(state("operational", [minor, newer, older])), older);
});

test("once the page admits anything, its own word is the news and the suspicion is not shown", () => {
  const one = suspect("major_outage", "api", "2026-08-19T14:00:00.000Z");
  assert.equal(openSuspicion(state("degraded", [one])), null);
  const incident: Incident = { id: "i1", name: "x", impact: "minor", status: "investigating", updatedAt: "2026-08-19T14:00:00.000Z" };
  assert.equal(openSuspicion(state("operational", [one], [incident])), null);
});

test("a page never read has nothing to be suspected against", () => {
  assert.equal(openSuspicion(state(null, [suspect("major_outage", "api", "2026-08-19T14:00:00.000Z")])), null);
});
