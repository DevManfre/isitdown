import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gcpAdapter, parseGcpHistory, parseGcpStatus } from "../../src/adapters/gcp.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "gcp",
  name: "Google Cloud",
  baseUrl: "https://status.cloud.google.com",
};

/**
 * Recorded from the live document (`npm run record-fixture`), trimmed to two
 * incidents with their updates cut short. The recorded feed had nothing open at
 * the time, so `incident.json` re-opens the newest of them by clearing its
 * `end`, which is exactly what the document looks like while an incident runs.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/gcp/${name}.json`, import.meta.url), "utf8");

const incident = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "abc123",
  external_desc: "Cloud Storage requests are failing in europe-west1.",
  status_impact: "SERVICE_DISRUPTION",
  severity: "medium",
  service_name: "Google Cloud Storage",
  begin: "2026-09-05T08:00:00+00:00",
  created: "2026-09-05T08:10:00+00:00",
  end: null,
  modified: "2026-09-05T09:00:00+00:00",
  ...over,
});

const list = (...incidents: Record<string, unknown>[]): string => JSON.stringify(incidents);

runAdapterContract("gcp", () => ({
  adapter: gcpAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/incidents.json": fixture("incident") },
  // Nothing but the id an incident is identifiable by.
  degraded: { "/incidents.json": JSON.stringify([{ id: "abc123" }]) },
}));

test("an incident with no end is open, and one with an end is not", () => {
  const status = parseGcpStatus(fixture("incident"), service);

  assert.equal(status.provider, "gcp");
  assert.equal(status.activeIncidents.length, 1);
  assert.equal(status.activeIncidents[0]?.id, "Kd7Bs2mQ1tPvY4Rn8Wc3");
  assert.equal(status.overallStatus, "partial_outage");
  assert.equal(status.activeIncidents[0]?.updatedAt, "2026-09-03T17:47:02.000Z");
});

test("a document whose every incident has ended reads as operational", () => {
  const status = parseGcpStatus(fixture("operational"), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("severity comes from the impact, not from the severity word beside it", () => {
  // The recorded document pairs "medium" with a disruption and "low" with an
  // advisory, so reading the word would report the wrong dial in both.
  const outage = parseGcpStatus(list(incident({ status_impact: "SERVICE_OUTAGE", severity: "medium" })), service);
  assert.equal(outage.overallStatus, "major_outage");

  const advisory = parseGcpStatus(
    list(incident({ status_impact: "SERVICE_INFORMATION", severity: "high" })),
    service,
  );
  // Surfaced, but an announcement is not an outage.
  assert.equal(advisory.overallStatus, "operational");
  assert.equal(advisory.activeIncidents.length, 1);
});

test("an impact nothing knows about reads as an outage rather than as calm", () => {
  const status = parseGcpStatus(list(incident({ status_impact: "SERVICE_WOBBLE" })), service);

  assert.equal(status.overallStatus, "major_outage");
});

test("an incident with no id is dropped rather than reported as new every cycle", () => {
  const status = parseGcpStatus(list(incident({ id: undefined })), service);

  assert.deepEqual(status.activeIncidents, []);
});

test("the history covers open and closed incidents, oldest start as coverage", () => {
  const history = parseGcpHistory(fixture("operational"), service);

  assert.equal(history.incidents.length, 2);
  assert.equal(history.coverageStart, history.incidents.map((entry) => entry.startedAt).sort()[0]);
  const closed = history.incidents.find((entry) => entry.id === "J5ia5t9p3g9Q5Wi7r8Ev");
  assert.equal(closed?.status, "resolved");
  assert.equal(closed?.resolvedAt, "2026-09-01T18:52:00.000Z");
});

test("an incident with no start date at all is left off the timeline", () => {
  const history = parseGcpHistory(list(incident({ begin: undefined, created: undefined })), service);

  assert.deepEqual(history.incidents, []);
  assert.equal(history.coverageStart, null);
});

test("a body that is not the incident list rejects rather than reading as calm", () => {
  assert.throws(() => parseGcpStatus(JSON.stringify({ incidents: [] }), service), /not an incident list/);
  assert.throws(() => parseGcpStatus("<html></html>", service), /not JSON/);
});
