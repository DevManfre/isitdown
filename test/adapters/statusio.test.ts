import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { endpointOf, parseStatusIoComponents, parseStatusIoStatus, statusIoAdapter } from "../../src/adapters/statusio.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "statusio", name: "Example", baseUrl: "https://api.status.io", options: { pageId: "abc123" } };
const fixture = readFileSync(new URL("../fixtures/statusio/status.json", import.meta.url), "utf8");
const body = (code: number): string => JSON.stringify({ result: { status_overall: { status_code: code }, status: [] } });

runAdapterContract("statusio", () => ({
  adapter: statusIoAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/1.0/status/abc123": fixture },
  degraded: { "/1.0/status/abc123": JSON.stringify({ result: { status_overall: {} } }) },
}));

test("status codes map onto the normalized vocabulary", () => {
  const read = (code: number) => parseStatusIoStatus(body(code), service).overallStatus;
  assert.equal(read(100), "operational");
  assert.equal(read(200), "unknown");
  assert.equal(read(300), "degraded");
  assert.equal(read(400), "partial_outage");
  assert.equal(read(500), "major_outage");
  assert.equal(read(600), "partial_outage");
  assert.equal(read(999), "major_outage");
});

test("the recorded document reads a major outage with its incident and upcoming maintenance", () => {
  const status = parseStatusIoStatus(fixture, service);
  assert.equal(status.overallStatus, "major_outage");
  assert.deepEqual(status.activeIncidents.map((i) => [i.id, i.name, i.createdAt, i.updatedAt]), [
    ["i1", "API errors", "2026-10-01T09:30:00.000Z", "2026-10-01T09:45:00.000Z"],
  ]);
  assert.deepEqual(status.maintenances.map((m) => [m.id, m.startsAt]), [["m1", "2026-10-05T01:00:00.000Z"]]);
});

test("scoping folds the selected components instead of the page-wide code", () => {
  const status = parseStatusIoStatus(fixture, { ...service, scopeToComponents: true, components: [{ id: "c1", name: "Web" }] });
  assert.equal(status.overallStatus, "operational");
});

test("the picker lists the page's components", () => {
  assert.deepEqual(parseStatusIoComponents(fixture, service).map((c) => [c.id, c.status]), [["c1", "operational"], ["c2", "major_outage"]]);
});

test("the endpoint is the base url itself, or the host plus options.pageId", () => {
  assert.equal(endpointOf(service), "https://api.status.io/1.0/status/abc123");
  assert.equal(endpointOf({ ...service, baseUrl: "https://api.status.io/1.0/status/xyz/", options: {} }), "https://api.status.io/1.0/status/xyz");
});
