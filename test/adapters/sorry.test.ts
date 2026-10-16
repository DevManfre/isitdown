import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSorryComponents, parseSorryStatus, sorryAdapter } from "../../src/adapters/sorry.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "sorry", name: "Sorry", baseUrl: "https://status.sorryapp.com" };
// Recorded from status.sorryapp.com's public API.
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/sorry/${name}.json`, import.meta.url), "utf8");
const status = (state: string): string => JSON.stringify({ page: { state } });
const NONE = JSON.stringify({ notices: [] });
const components = (...states: string[]): string =>
  JSON.stringify({ components: states.map((state, i) => ({ id: i + 1, name: `C${i + 1}`, state })) });

runAdapterContract("sorry", () => ({
  adapter: sorryAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: {
    "/api/v1/status": fixture("status"),
    "/api/v1/components": fixture("components"),
    "/api/v1/notices": fixture("notices"),
  },
  degraded: {
    "/api/v1/status": JSON.stringify({ page: {} }),
    "/api/v1/components": JSON.stringify({ components: [{ id: 1 }] }),
    "/api/v1/notices": JSON.stringify({ notices: [{ id: 1 }] }),
  },
}));

test("the recorded page reads operational, with the announced maintenance as a window", () => {
  const read = parseSorryStatus(fixture("status"), fixture("components"), fixture("notices"), service);
  assert.equal(read.overallStatus, "operational");
  assert.deepEqual(read.activeIncidents, []);
  assert.ok(read.maintenances.some((w) => w.name === "Routine Database Maintenance" && w.endsAt === "2026-10-20T13:00:00.000Z"));
});

test("Sorry's words map: partially-degraded degraded, degraded a partial outage, unknown ones worst", () => {
  const read = (s: string) => parseSorryStatus(status(s), components(), NONE, service).overallStatus;
  assert.equal(read("operational"), "operational");
  assert.equal(read("partially-degraded"), "degraded");
  assert.equal(read("degraded"), "partial_outage");
  assert.equal(read("exploded"), "major_outage");
});

test("an open unplanned notice is an incident; a resolved one is not", () => {
  const notices = JSON.stringify({
    notices: [
      { id: 1, type: "unplanned", state: "investigating", subject: "API slow", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:10:00Z" },
      { id: 2, type: "unplanned", state: "resolved", subject: "Old" },
    ],
  });
  const read = parseSorryStatus(status("degraded"), components(), notices, service);
  assert.deepEqual(read.activeIncidents.map((i) => [i.id, i.name, i.createdAt]), [["1", "API slow", "2026-10-01T09:00:00Z"]]);
});

test("scoping folds only the selected components", () => {
  const read = parseSorryStatus(status("degraded"), components("operational", "degraded"), NONE, {
    ...service,
    scopeToComponents: true,
    components: [{ id: "1", name: "C1" }],
  });
  assert.equal(read.overallStatus, "operational");
});

test("the picker lists components with their parent as the group", () => {
  const body = JSON.stringify({ components: [{ id: 1, name: "Web", state: "operational", parent_id: null }, { id: 2, name: "API", state: "degraded", parent_id: 1 }] });
  assert.deepEqual(parseSorryComponents(body, service).map((c) => [c.id, c.group, c.status]), [["1", null, "operational"], ["2", "Web", "partial_outage"]]);
});
