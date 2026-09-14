import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseUptimeComComponents,
  parseUptimeComHistory,
  parseUptimeComStatus,
  uptimeComAdapter,
} from "../../src/adapters/uptimecom.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "uptimecom",
  name: "Uptime.com",
  baseUrl: "https://status.uptime.com/statuspage/uptime-status",
};

/**
 * Recorded from Uptime.com's own status page (`npm run record-fixture`), trimmed
 * to four components — one of them a group with two subcomponents — and, in the
 * history, two closed incidents and the scheduled maintenance that was open at
 * the time. The untrimmed pair is 240 kB, nearly all of it per-component
 * response-time series this adapter never reads.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/uptimecom/${name}.json`, import.meta.url), "utf8");

const AJAX = "/ajax";
const HISTORY = "/history";

/** An `/ajax` body built around whatever a test is about. */
const pageWith = (data: Record<string, unknown>): string =>
  JSON.stringify({ error: null, fields: {}, data: { global_is_operational: true, components: [], ...data } });

const component = (fields: Record<string, unknown>, id: number | string = 2): Record<string, unknown> => ({
  id,
  name: "API",
  is_group: false,
  status: "operational",
  subcomponents: [],
  ...fields,
});

const incident = (fields: Record<string, unknown>, id: number | string = 1): Record<string, unknown> => ({
  id,
  name: "Delayed check state updates",
  incident_type: "INCIDENT",
  starts_at: "2026-09-08T08:51:10Z",
  ends_at: null,
  affected_components: [],
  updates: [{ id: 1, updated_at: "2026-09-08T09:30:00Z", incident_state: "investigating" }],
  ...fields,
});

runAdapterContract("uptimecom", () => ({
  adapter: uptimeComAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { [AJAX]: fixture("ajax"), [HISTORY]: fixture("history") },
  // Nothing but the envelope and the ids each row is addressed by.
  degraded: {
    [AJAX]: JSON.stringify({ data: { components: [{ id: 2 }], active_incidents: [{ id: 1 }] } }),
    [HISTORY]: JSON.stringify({ data: { past_incidents: [{ id: 1, starts_at: "2026-09-08T08:51:10Z" }] } }),
  },
}));

test("a page whose components are all operational reads operational", () => {
  const status = parseUptimeComStatus(fixture("ajax"), service);

  assert.equal(status.provider, "uptimecom");
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

const statuses: { word: string; expected: string }[] = [
  { word: "operational", expected: "operational" },
  { word: "degraded-performance", expected: "degraded" },
  { word: "partial-outage", expected: "partial_outage" },
  { word: "major-outage", expected: "major_outage" },
];

for (const { word, expected } of statuses) {
  test(`a component reading ${word} is ${expected}`, () => {
    const body = pageWith({ components: [component({ status: word })] });
    assert.equal(parseUptimeComStatus(body, service).overallStatus, expected);
  });
}

test("a status word nothing knows is treated as the worst case, never as calm", () => {
  const body = pageWith({ components: [component({ status: "on fire" })] });

  assert.equal(parseUptimeComStatus(body, service).overallStatus, "major_outage");
});

test("a component under maintenance abstains rather than claiming to be up", () => {
  const body = pageWith({ components: [component({ status: "under-maintenance" })] });

  assert.equal(parseUptimeComStatus(body, service).overallStatus, "unknown");
});

test("a group is read through its subcomponents, not twice", () => {
  const body = pageWith({
    components: [
      component(
        {
          name: "Check Servers",
          is_group: true,
          status: "operational",
          subcomponents: [component({ name: "Vienna", status: "partial-outage" }, 44)],
        },
        39,
      ),
    ],
  });

  const status = parseUptimeComStatus(body, service);

  assert.equal(status.overallStatus, "partial_outage");
  assert.deepEqual(
    parseUptimeComComponents(body, service).map((entry) => entry.id),
    ["44"],
  );
});

test("the page's own flag raises a reading its components do not explain", () => {
  const body = pageWith({ global_is_operational: false, components: [component({})] });

  assert.equal(parseUptimeComStatus(body, service).overallStatus, "degraded");
});

test("the flag never lowers a reading: a degraded component outranks an operational page", () => {
  const body = pageWith({ global_is_operational: true, components: [component({ status: "major-outage" })] });

  assert.equal(parseUptimeComStatus(body, service).overallStatus, "major_outage");
});

test("an open incident carries the provider's own state word and its newest update's time", () => {
  const body = pageWith({ components: [component({})], active_incidents: [incident({})] });

  assert.deepEqual(parseUptimeComStatus(body, service).activeIncidents, [
    {
      id: "1",
      name: "Delayed check state updates",
      impact: "investigating",
      status: "investigating",
      updatedAt: "2026-09-08T09:30:00.000Z",
    },
  ]);
});

test("an open maintenance is a window, not an incident", () => {
  const body = pageWith({
    components: [component({})],
    active_incidents: [
      incident(
        {
          name: "Monitoring Location Decommissioning",
          incident_type: "SCHEDULED_MAINTENANCE",
          starts_at: "2026-09-22T12:00:00Z",
          ends_at: "2026-09-22T13:00:00Z",
          affected_components: [{ id: 86, name: "Panama-Panama City", status: "under-maintenance" }],
          updates: [{ id: 1, updated_at: "2026-09-20T12:00:00Z", incident_state: "maintenance" }],
        },
        721,
      ),
    ],
  });

  const status = parseUptimeComStatus(body, service);

  assert.deepEqual(status.activeIncidents, []);
  assert.deepEqual(status.maintenances, [
    {
      id: "721",
      name: "Monitoring Location Decommissioning",
      status: "maintenance",
      startsAt: "2026-09-22T12:00:00.000Z",
      endsAt: "2026-09-22T13:00:00.000Z",
      componentIds: ["86"],
    },
  ]);
});

test("a window the page lists as upcoming is read the same way", () => {
  const body = pageWith({
    upcoming_maintenance: [
      incident({ incident_type: "SCHEDULED_MAINTENANCE", starts_at: "2026-10-01T00:00:00Z" }, 900),
    ],
  });

  assert.deepEqual(
    parseUptimeComStatus(body, service).maintenances.map((entry) => entry.id),
    ["900"],
  );
});

test("a window we cannot place on a clock is dropped", () => {
  const body = pageWith({
    upcoming_maintenance: [incident({ incident_type: "SCHEDULED_MAINTENANCE", starts_at: null }, 900)],
  });

  assert.deepEqual(parseUptimeComStatus(body, service).maintenances, []);
});

test("a body that is not this provider's payload at all throws", () => {
  assert.throws(() => parseUptimeComStatus(JSON.stringify([{ id: 1 }]), service), /uptimecom/);
  assert.throws(() => parseUptimeComStatus("not json", service), /uptimecom/);
});

test("a selected component is reported with the provider's current name and status", () => {
  const body = pageWith({ components: [component({ status: "degraded-performance" })] });

  const status = parseUptimeComStatus(body, {
    ...service,
    components: [
      { id: "2", name: "stored name" },
      { id: "gone", name: "Retired" },
    ],
  });

  assert.deepEqual(status.components, [
    { id: "2", name: "API", status: "degraded" },
    // A selection the page no longer lists is unknown, never a recovery.
    { id: "gone", name: "Retired", status: "unknown" },
  ]);
});

test("a scoped provider reads its selection and drops an incident attributed elsewhere", () => {
  const body = pageWith({
    global_is_operational: false,
    components: [component({}), component({ name: "Telemetry", status: "major-outage" }, 3)],
    active_incidents: [incident({ affected_components: [{ id: 3, name: "Telemetry" }] })],
  });

  const status = parseUptimeComStatus(body, {
    ...service,
    components: [{ id: "2", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(status.activeIncidents, [], "the incident is another component's");
  assert.equal(status.overallStatus, "operational", "the reading is the selection's");
});

test("a page-wide incident reaches a scoped provider: it is attributed to nothing", () => {
  const body = pageWith({
    components: [component({})],
    active_incidents: [incident({ affected_components: [] })],
  });

  const status = parseUptimeComStatus(body, {
    ...service,
    components: [{ id: "2", name: "API" }],
    scopeToComponents: true,
  });

  assert.deepEqual(
    status.activeIncidents.map((entry) => entry.id),
    ["1"],
  );
});

test("the history carries the closed incidents, with their end as the closure", () => {
  const { incidents } = parseUptimeComHistory(fixture("history"), service);
  const closed = incidents.find((entry) => entry.id === "722");

  assert.deepEqual(closed, {
    id: "722",
    name: "Delayed check state updates in the M2 locations",
    impact: "resolved",
    status: "resolved",
    startedAt: "2026-09-08T08:51:10.449Z",
    resolvedAt: "2026-09-08T12:15:00.000Z",
    updatedAt: "2026-09-10T13:51:03.887Z",
  });
});

test("the history leaves maintenance out: a planned window is not an incident", () => {
  assert.deepEqual(
    parseUptimeComHistory(fixture("history"), service)
      .incidents.map((entry) => entry.id)
      .sort(),
    ["720", "722"],
  );
});

test("coverage never claims a full history: the page serves the window it is set to", () => {
  const { incidents, coverageStart } = parseUptimeComHistory(fixture("history"), service);
  const oldest = incidents.map((entry) => entry.startedAt).sort()[0];

  assert.equal(coverageStart, oldest);
});

test("the component list carries each leaf's group", () => {
  const components = parseUptimeComComponents(fixture("ajax"), service);
  const grouped = components.find((entry) => entry.name === "Austria-Vienna");

  assert.equal(components[0]?.id, "2");
  assert.equal(components[0]?.name, "API");
  assert.equal(components[0]?.group, null);
  assert.equal(components[0]?.showcase, false);
  assert.equal(components[0]?.status, "operational");
  assert.equal(grouped?.group, "Check Servers");
});

test("a reading is one request to the page's own ajax document, asking for JSON", async () => {
  const seen: { url: string | undefined; accept: string | undefined }[] = [];

  await withServer(
    (req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture("ajax"));
    },
    async (baseUrl) => {
      // A trailing slash on the configured page must not double up in the path.
      await uptimeComAdapter.fetchStatus({ ...service, baseUrl: `${baseUrl}/` }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(
    seen.map((request) => request.url),
    [AJAX],
  );
  assert.match(seen[0]?.accept ?? "", /application\/json/);
});
