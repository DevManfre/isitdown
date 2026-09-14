import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cachetAdapter,
  parseCachetComponents,
  parseCachetHistory,
  parseCachetStatus,
} from "../../src/adapters/cachet.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "cachet",
  name: "Cachet",
  baseUrl: "https://demo.cachethq.io",
};

/** Recorded from Cachet's own demo instance (`npm run record-fixture`). */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/cachet/${name}.json`, import.meta.url), "utf8");

const COMPONENTS = "/api/v1/components?per_page=100";
const INCIDENTS = "/api/v1/incidents?per_page=100";
const SCHEDULES = "/api/v1/schedules?per_page=100";
const GROUPS = "/api/v1/components/groups?per_page=100";

/** A paginated Cachet envelope around whatever rows a test is about. */
const page = (rows: unknown[]): string =>
  JSON.stringify({ meta: { pagination: { total: rows.length, count: rows.length } }, data: rows });

const component = (fields: Record<string, unknown>, id: number | string = 1): string =>
  page([{ id, name: "API", status: 1, group_id: 0, enabled: true, ...fields }]);

const incident = (fields: Record<string, unknown>, id: number | string = 1): Record<string, unknown> => ({
  id,
  name: "Our monkeys aren't performing",
  component_id: 0,
  is_resolved: false,
  status: 1,
  latest_status: 3,
  latest_human_status: "Watching",
  occurred_at: "2026-09-01 08:00:00",
  updated_at: "2026-09-01 09:30:00",
  ...fields,
});

const EMPTY = page([]);

runAdapterContract("cachet", () => ({
  adapter: cachetAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: {
    [COMPONENTS]: fixture("components"),
    [INCIDENTS]: fixture("incidents"),
    [SCHEDULES]: fixture("schedules"),
    [GROUPS]: fixture("groups"),
  },
  // Nothing but the ids every row is addressed by.
  degraded: {
    [COMPONENTS]: page([{ id: 1 }]),
    [INCIDENTS]: page([{ id: 1 }]),
    [SCHEDULES]: page([{ id: 1 }]),
    [GROUPS]: page([{ id: 1 }]),
  },
}));

test("a page whose every component is operational reads operational", () => {
  const status = parseCachetStatus(fixture("components"), fixture("incidents"), fixture("schedules"), service);

  assert.equal(status.provider, "cachet");
  assert.equal(status.overallStatus, "operational");
});

const statuses: { status: number; expected: string }[] = [
  { status: 1, expected: "operational" },
  { status: 2, expected: "degraded" },
  { status: 3, expected: "partial_outage" },
  { status: 4, expected: "major_outage" },
];

for (const { status, expected } of statuses) {
  test(`a component at status ${status} reads as ${expected}`, () => {
    const reading = parseCachetStatus(component({ status }), EMPTY, EMPTY, service);
    assert.equal(reading.overallStatus, expected);
  });
}

test("a status number nothing knows is treated as the worst case, never as calm", () => {
  assert.equal(parseCachetStatus(component({ status: 9 }), EMPTY, EMPTY, service).overallStatus, "major_outage");
});

test("the page-wide reading is the worst component, not the first one", () => {
  const components = page([
    { id: 1, name: "API", status: 1 },
    { id: 2, name: "Website", status: 3 },
    { id: 3, name: "Docs", status: 2 },
  ]);

  assert.equal(parseCachetStatus(components, EMPTY, EMPTY, service).overallStatus, "partial_outage");
});

test("a component the operator disabled is not part of the reading", () => {
  const components = page([
    { id: 1, name: "API", status: 1, enabled: true },
    { id: 2, name: "Retired", status: 4, enabled: false },
  ]);

  assert.equal(parseCachetStatus(components, EMPTY, EMPTY, service).overallStatus, "operational");
});

test("a page with no component at all abstains rather than claiming to be up", () => {
  assert.equal(parseCachetStatus(EMPTY, EMPTY, EMPTY, service).overallStatus, "unknown");
});

test("an unresolved incident is open, with Cachet's own word for its state", () => {
  const status = parseCachetStatus(component({}), page([incident({})]), EMPTY, service);

  assert.deepEqual(status.activeIncidents, [
    {
      id: "1",
      name: "Our monkeys aren't performing",
      impact: "Watching",
      status: "Watching",
      // Cachet's local timestamp, read as UTC.
      updatedAt: "2026-09-01T09:30:00.000Z",
    },
  ]);
});

test("a resolved incident is not open", () => {
  const status = parseCachetStatus(component({}), page([incident({ is_resolved: true })]), EMPTY, service);

  assert.deepEqual(status.activeIncidents, []);
});

test("an incident from a Cachet too old to publish the flag closes on its Fixed update", () => {
  const body = page([incident({ is_resolved: undefined, latest_status: 4, latest_human_status: "Fixed" })]);

  assert.deepEqual(parseCachetStatus(component({}), body, EMPTY, service).activeIncidents, []);
});

test("a schedule is a maintenance window, not an incident", () => {
  const schedules = page([
    {
      id: 7,
      name: "Database upgrade",
      status: 0,
      human_status: "Upcoming",
      scheduled_at: "2026-09-20 01:00:00",
      completed_at: "2026-09-20 03:00:00",
      components: [{ id: 1, name: "API" }],
    },
  ]);

  const status = parseCachetStatus(component({}), EMPTY, schedules, service);

  assert.deepEqual(status.activeIncidents, []);
  assert.deepEqual(status.maintenances, [
    {
      id: "7",
      name: "Database upgrade",
      status: "Upcoming",
      startsAt: "2026-09-20T01:00:00.000Z",
      endsAt: "2026-09-20T03:00:00.000Z",
      componentIds: ["1"],
    },
  ]);
});

test("a completed schedule is dropped: it can no longer silence anything", () => {
  const schedules = page([{ id: 7, name: "Done", status: 2, scheduled_at: "2026-09-01 01:00:00" }]);

  assert.deepEqual(parseCachetStatus(component({}), EMPTY, schedules, service).maintenances, []);
});

test("a schedule we cannot place on a clock is dropped", () => {
  const schedules = page([
    { id: 7, name: "Whenever", status: 0, scheduled_at: "soon" },
    { id: 8, name: "Never", status: 0 },
  ]);

  assert.deepEqual(parseCachetStatus(component({}), EMPTY, schedules, service).maintenances, []);
});

test("a body that is not Cachet's payload at all throws", () => {
  assert.throws(() => parseCachetStatus(JSON.stringify([{ id: 1 }]), EMPTY, EMPTY, service), /cachet/);
  assert.throws(() => parseCachetStatus("not json", EMPTY, EMPTY, service), /cachet/);
});

test("a selected component is reported with the provider's current name and status", () => {
  const status = parseCachetStatus(component({ name: "API", status: 2 }), EMPTY, EMPTY, {
    ...service,
    components: [
      { id: "1", name: "stored name" },
      { id: "gone", name: "Retired" },
    ],
  });

  assert.deepEqual(status.components, [
    { id: "1", name: "API", status: "degraded" },
    // A selection the page no longer lists is unknown, never a recovery.
    { id: "gone", name: "Retired", status: "unknown" },
  ]);
});

test("a scoped provider reads its selection and drops an incident attributed elsewhere", () => {
  const components = page([
    { id: 1, name: "API", status: 1 },
    { id: 2, name: "Telemetry", status: 4 },
  ]);
  const incidents = page([incident({ component_id: 2 })]);

  const status = parseCachetStatus(components, incidents, EMPTY, {
    ...service,
    components: [{ id: "1", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(status.activeIncidents, [], "the incident is another component's");
  assert.equal(status.overallStatus, "operational", "the reading is the selection's");
});

test("a page-wide incident reaches a scoped provider: it is attributed to nothing", () => {
  const incidents = page([incident({ component_id: 0 })]);

  const status = parseCachetStatus(component({}), incidents, EMPTY, {
    ...service,
    components: [{ id: "1", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(
    status.activeIncidents.map((entry) => entry.id),
    ["1"],
  );
});

test("the history carries the incidents, resolved ones closed by their last update", () => {
  const { incidents } = parseCachetHistory(fixture("incidents"), service);
  const resolved = incidents.find((entry) => entry.id === "1");

  assert.equal(resolved?.name, "Our monkeys aren't performing");
  assert.equal(resolved?.status, "Fixed");
  assert.equal(resolved?.resolvedAt, resolved?.updatedAt);
  assert.equal(incidents.find((entry) => entry.id === "2")?.resolvedAt, null);
});

test("coverage never claims a full history: this is one page of the incident list", () => {
  const { incidents, coverageStart } = parseCachetHistory(fixture("incidents"), service);
  const oldest = incidents.map((entry) => entry.startedAt).sort()[0];

  assert.equal(coverageStart, oldest);
});

test("the component list carries each component's group name, resolved from the group list", () => {
  const components = parseCachetComponents(fixture("components"), fixture("groups"), service);
  const grouped = components.find((entry) => entry.name === "Checkmango");

  assert.equal(components[0]?.id, "1");
  assert.equal(components[0]?.name, "API");
  // Cachet writes 0 for an ungrouped component rather than leaving it out.
  assert.equal(components[0]?.group, null);
  assert.equal(components[0]?.showcase, false);
  assert.equal(components[0]?.status, "operational");
  assert.equal(grouped?.group, "Services");
});

test("a component whose group the page did not publish is listed ungrouped", () => {
  const components = parseCachetComponents(component({ group_id: 42 }), page([]), service);

  assert.equal(components[0]?.group, null);
});

test("a reading is three requests to the documented endpoints, asking for JSON", async () => {
  const seen: { url: string | undefined; accept: string | undefined }[] = [];

  await withServer(
    (req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.includes("incidents") === true ? fixture("incidents") : fixture("components"));
    },
    async (baseUrl) => {
      await cachetAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(seen.map((request) => request.url).sort(), [COMPONENTS, INCIDENTS, SCHEDULES].sort());
  assert.match(seen[0]?.accept ?? "", /application\/json/);
});
