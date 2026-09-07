import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  betterStackAdapter,
  parseBetterStackComponents,
  parseBetterStackHistory,
  parseBetterStackStatus,
} from "../../src/adapters/betterstack.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "betterstack",
  name: "Better Stack",
  baseUrl: "https://status.betterstack.com",
};

/**
 * Recorded from Better Stack's own status page (`npm run record-fixture`),
 * trimmed to two sections, three resources, three reports — one of them a
 * maintenance — and the updates those reports link to. Every resource's
 * 90-day `status_history` is cut to three days: this adapter reads none of it,
 * and the untrimmed answer is a 47 kB fixture.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/betterstack/${name}.json`, import.meta.url), "utf8");

/** An `/index.json` body built around one report or resource. */
const pageWith = (
  aggregate: string,
  included: { id: string | number; type: string; attributes: unknown; relationships?: unknown }[] = [],
): string => JSON.stringify({ data: { attributes: { aggregate_state: aggregate } }, included });

const report = (attributes: Record<string, unknown>, id = "r1") => ({
  id,
  type: "status_report",
  attributes: {
    title: "Something is wrong",
    report_type: "manual",
    starts_at: "2026-09-01T08:00:00.000Z",
    ends_at: null,
    aggregate_state: "downtime",
    affected_resources: [],
    ...attributes,
  },
});

const resource = (attributes: Record<string, unknown>, id = "c1") => ({
  id,
  type: "status_page_resource",
  attributes: { public_name: "API", status: "operational", ...attributes },
});

runAdapterContract("betterstack", () => ({
  adapter: betterStackAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/index.json": fixture("operational") },
  // Nothing but the ids and types the document is addressed by.
  degraded: {
    "/index.json": JSON.stringify({
      included: [
        { id: "c1", type: "status_page_resource", attributes: {} },
        { id: "r1", type: "status_report", attributes: { starts_at: "2026-09-01T08:00:00.000Z" } },
      ],
    }),
  },
}));

test("a page whose aggregate state is operational reads operational", () => {
  const status = parseBetterStackStatus(fixture("operational"), service);

  assert.equal(status.provider, "betterstack");
  assert.equal(status.overallStatus, "operational");
  // Every report on the recorded page is resolved, so nothing is open.
  assert.deepEqual(status.activeIncidents, []);
});

const states: { state: string; expected: string }[] = [
  { state: "operational", expected: "operational" },
  { state: "degraded", expected: "degraded" },
  { state: "downtime", expected: "major_outage" },
];

for (const { state, expected } of states) {
  test(`an aggregate state of ${state} reads as ${expected}`, () => {
    assert.equal(parseBetterStackStatus(pageWith(state), service).overallStatus, expected);
  });
}

test("a state word nothing knows is treated as the worst case, never as calm", () => {
  assert.equal(parseBetterStackStatus(pageWith("on fire"), service).overallStatus, "major_outage");
});

test("a page under maintenance abstains rather than claiming to be up", () => {
  assert.equal(parseBetterStackStatus(pageWith("maintenance"), service).overallStatus, "unknown");
});

test("an unresolved report is an open incident, timestamped by its newest update", () => {
  const body = pageWith("downtime", [
    { id: "u1", type: "status_update", attributes: { published_at: "2026-09-01T09:00:00.000Z" } },
    { id: "u2", type: "status_update", attributes: { published_at: "2026-09-01T11:00:00.000Z" } },
    report(
      { aggregate_state: "downtime" },
      "r1",
    ),
  ]);
  const withUpdates = JSON.parse(body) as { included: { id: string; relationships?: unknown }[] };
  withUpdates.included[2]!.relationships = {
    status_updates: { data: [{ id: "u1", type: "status_update" }, { id: "u2", type: "status_update" }] },
  };

  const status = parseBetterStackStatus(JSON.stringify(withUpdates), service);

  assert.deepEqual(status.activeIncidents, [
    {
      id: "r1",
      name: "Something is wrong",
      // The provider's own word, unnormalised, for both fields.
      impact: "downtime",
      status: "downtime",
      // The newest of the two updates, not the report's start.
      updatedAt: "2026-09-01T11:00:00.000Z",
    },
  ]);
});

test("a report with no update at all falls back to when it started", () => {
  const status = parseBetterStackStatus(pageWith("downtime", [report({})]), service);

  assert.equal(status.activeIncidents[0]?.updatedAt, "2026-09-01T08:00:00.000Z");
});

test("a resolved report is not an open incident", () => {
  const body = pageWith("operational", [report({ aggregate_state: "resolved" })]);

  assert.deepEqual(parseBetterStackStatus(body, service).activeIncidents, []);
});

test("a report we cannot place on a clock is dropped", () => {
  const body = pageWith("downtime", [report({ starts_at: undefined }), report({ starts_at: "whenever" }, "r2")]);

  assert.deepEqual(parseBetterStackStatus(body, service).activeIncidents, []);
});

test("a maintenance report is a window, not an incident", () => {
  const body = pageWith("maintenance", [
    report(
      {
        title: "Migrating sources",
        report_type: "maintenance",
        aggregate_state: "maintenance",
        starts_at: "2026-09-10T00:00:00.000Z",
        ends_at: "2026-09-10T17:00:00.000Z",
        affected_resources: [{ status_page_resource_id: "c1", status: "maintenance" }],
      },
      "m1",
    ),
  ]);

  const status = parseBetterStackStatus(body, service);

  assert.deepEqual(status.activeIncidents, []);
  assert.deepEqual(status.maintenances, [
    {
      id: "m1",
      name: "Migrating sources",
      status: "maintenance",
      startsAt: "2026-09-10T00:00:00.000Z",
      endsAt: "2026-09-10T17:00:00.000Z",
      componentIds: ["c1"],
    },
  ]);
});

test("a finished maintenance window is dropped: it can no longer silence anything", () => {
  const body = pageWith("operational", [
    report({ report_type: "maintenance", aggregate_state: "resolved" }, "m1"),
  ]);

  assert.deepEqual(parseBetterStackStatus(body, service).maintenances, []);
});

test("a body that is not this provider's payload at all throws", () => {
  assert.throws(() => parseBetterStackStatus(JSON.stringify([{ id: 1 }]), service), /betterstack/);
  assert.throws(() => parseBetterStackStatus("not json", service), /betterstack/);
});

test("the component list carries each resource's section as its group", () => {
  const components = parseBetterStackComponents(fixture("operational"), service);
  const first = components[0];

  assert.equal(components.length, 3);
  assert.equal(first?.id, "4018902");
  assert.equal(first?.name, "Better Stack");
  assert.equal(first?.group, "Better Stack ");
  assert.equal(first?.showcase, false);
  assert.equal(first?.status, "operational");
  // A resource Better Stack is not watching abstains rather than reading up.
  assert.equal(
    components.find((component) => component.name === "Uptime backend processing health")?.status,
    "unknown",
  );
});

test("a selected resource is reported with the provider's current name and status", () => {
  const body = pageWith("degraded", [resource({ public_name: "API", status: "degraded" })]);
  const status = parseBetterStackStatus(
    body,
    { ...service, components: [{ id: "c1", name: "stored name" }, { id: "gone", name: "Retired" }] },
  );

  assert.deepEqual(status.components, [
    { id: "c1", name: "API", status: "degraded" },
    // A selection the page no longer lists is unknown, never a recovery.
    { id: "gone", name: "Retired", status: "unknown" },
  ]);
});

test("a scoped provider reads its selection and drops an incident attributed elsewhere", () => {
  const body = pageWith("downtime", [
    resource({ public_name: "API", status: "operational" }, "c1"),
    resource({ public_name: "Telemetry", status: "downtime" }, "c2"),
    report({ affected_resources: [{ status_page_resource_id: "c2", status: "downtime" }] }, "r1"),
  ]);

  const status = parseBetterStackStatus(body, {
    ...service,
    components: [{ id: "c1", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(status.activeIncidents, [], "the incident is another component's");
  assert.equal(status.overallStatus, "operational", "the reading is the selection's");
});

test("a page-wide report reaches a scoped provider: it is attributed to nothing", () => {
  const body = pageWith("downtime", [
    resource({ public_name: "API", status: "operational" }, "c1"),
    report({ affected_resources: [] }, "r1"),
  ]);

  const status = parseBetterStackStatus(body, {
    ...service,
    components: [{ id: "c1", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(
    status.activeIncidents.map((entry) => entry.id),
    ["r1"],
  );
});

test("the history carries the reports, resolved ones closed by their newest update", () => {
  const { incidents } = parseBetterStackHistory(fixture("operational"), service);
  const resolved = incidents.find((incident) => incident.id === "1050825");

  assert.deepEqual(resolved, {
    id: "1050825",
    name: "Delayed data processing in the Europe region",
    impact: "resolved",
    status: "resolved",
    startedAt: "2026-09-04T13:50:00.000Z",
    // `ends_at` is null on this report — Better Stack closes one by state — so
    // its newest update is the only closure time the document offers.
    resolvedAt: "2026-09-06T19:13:00.000Z",
    updatedAt: "2026-09-06T19:13:00.000Z",
  });
});

test("an unresolved report has no closure timestamp in the history", () => {
  const { incidents } = parseBetterStackHistory(pageWith("downtime", [report({})]), service);

  assert.equal(incidents[0]?.resolvedAt, null);
});

test("the history leaves maintenance windows out: a planned window is not an incident", () => {
  const body = pageWith("operational", [
    report({ report_type: "maintenance", aggregate_state: "resolved" }, "m1"),
    report({ aggregate_state: "resolved" }, "r1"),
  ]);

  assert.deepEqual(
    parseBetterStackHistory(body, service).incidents.map((incident) => incident.id),
    ["r1"],
  );
});

test("coverage never claims a full history: the page shows what it chooses to", () => {
  const { incidents, coverageStart } = parseBetterStackHistory(fixture("operational"), service);
  const oldest = incidents.map((incident) => incident.startedAt).sort()[0];

  assert.equal(coverageStart, oldest);
});

test("every read is one request to the documented endpoint, asking for JSON", async () => {
  const seen: { url: string | undefined; accept: string | undefined }[] = [];

  await withServer(
    (req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture("operational"));
    },
    async (baseUrl) => {
      await betterStackAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(
    seen.map((request) => request.url),
    ["/index.json"],
  );
  assert.match(seen[0]?.accept ?? "", /application\/json/);
});
