import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseUptimeKumaComponents,
  parseUptimeKumaStatus,
  uptimeKumaAdapter,
} from "../../src/adapters/uptimekuma.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "uptimekuma",
  name: "Uptime Kuma",
  baseUrl: "https://uptime.example.com",
  options: { slug: "demo" },
};

/**
 * Recorded from an Uptime Kuma instance run for the purpose
 * (`npm run record-fixture`), with two monitors — one up, one down — a pinned
 * incident and a window under maintenance.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/uptimekuma/${name}.json`, import.meta.url), "utf8");

const PAGE = "/api/status-page/demo";
const HEARTBEAT = "/api/status-page/heartbeat/demo";

/** A status-page body carrying one group of monitors. */
const pageWith = (monitors: { id: number | string; name: string }[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    config: { slug: "demo", title: "Demo" },
    incident: null,
    publicGroupList: [{ id: 1, name: "Services", weight: 1, monitorList: monitors }],
    maintenanceList: [],
    ...extra,
  });

/** A heartbeat body: the newest beat per monitor is the last one in its list. */
const beats = (byMonitor: Record<string, number[]>): string =>
  JSON.stringify({
    heartbeatList: Object.fromEntries(
      Object.entries(byMonitor).map(([id, list]) => [
        id,
        list.map((status, index) => ({ status, time: `2026-09-01 08:0${index}:00`, msg: "", ping: 12 })),
      ]),
    ),
    uptimeList: {},
  });

const ONE = [{ id: 1, name: "API" }];

runAdapterContract("uptimekuma", () => ({
  adapter: uptimeKumaAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { [PAGE]: fixture("status-page"), [HEARTBEAT]: fixture("heartbeat") },
  // Nothing but the two containers each document is addressed by.
  degraded: {
    [PAGE]: JSON.stringify({ publicGroupList: [{ monitorList: [{ id: 1 }] }] }),
    [HEARTBEAT]: JSON.stringify({ heartbeatList: { "1": [{}] } }),
  },
}));

test("a page whose monitors are all up reads operational", () => {
  const status = parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [1, 1] }), service);

  assert.equal(status.provider, "uptimekuma");
  assert.equal(status.overallStatus, "operational");
});

test("the recorded page reads down: its one monitor still reporting is down", () => {
  // The other monitor went under maintenance while the fixture was recorded, so
  // it abstains — and the page is then everything that is left, which is down.
  const status = parseUptimeKumaStatus(fixture("status-page"), fixture("heartbeat"), service);

  assert.equal(status.overallStatus, "major_outage");
});

test("a page with one monitor up and one down is a partial outage, not a major one", () => {
  const page = pageWith([...ONE, { id: 2, name: "Webhooks" }]);

  assert.equal(parseUptimeKumaStatus(page, beats({ "1": [1], "2": [0] }), service).overallStatus, "partial_outage");
});

test("a page where every monitor is down reads as a major outage", () => {
  const page = pageWith([...ONE, { id: 2, name: "Webhooks" }]);

  assert.equal(parseUptimeKumaStatus(page, beats({ "1": [0], "2": [0] }), service).overallStatus, "major_outage");
});

test("a monitor still retrying degrades the page rather than downing it", () => {
  assert.equal(parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [1, 2] }), service).overallStatus, "degraded");
});

test("only the newest beat counts: an outage that recovered is not the reading", () => {
  assert.equal(parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [0, 0, 1] }), service).overallStatus, "operational");
});

test("a monitor under maintenance abstains rather than dragging the page down", () => {
  const page = pageWith([...ONE, { id: 2, name: "Webhooks" }]);

  assert.equal(parseUptimeKumaStatus(page, beats({ "1": [1], "2": [3] }), service).overallStatus, "operational");
});

test("a page whose monitors have no beat at all abstains rather than claiming to be up", () => {
  assert.equal(parseUptimeKumaStatus(pageWith(ONE), beats({}), service).overallStatus, "unknown");
});

test("a beat number nothing knows is treated as the worst case, never as calm", () => {
  assert.equal(parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [7] }), service).overallStatus, "major_outage");
});

test("the pinned notice is an open incident, carrying Kuma's own style word", () => {
  const status = parseUptimeKumaStatus(fixture("status-page"), fixture("heartbeat"), service);

  assert.deepEqual(status.activeIncidents, [
    {
      id: "1",
      name: "Elevated error rates",
      impact: "warning",
      status: "warning",
      // Kuma's server-local timestamp, read as UTC.
      updatedAt: "2026-09-12T12:24:51.000Z",
    },
  ]);
});

test("a page with nothing pinned has no open incident", () => {
  assert.deepEqual(parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [1] }), service).activeIncidents, []);
});

test("a 2.x page writing a list of incidents is read the same way", () => {
  const page = pageWith(ONE, {
    incident: undefined,
    incidents: [{ id: 9, title: "Degraded search", style: "danger", createdDate: "2026-09-01 08:00:00" }],
  });

  assert.deepEqual(
    parseUptimeKumaStatus(page, beats({ "1": [1] }), service).activeIncidents.map((entry) => entry.id),
    ["9"],
  );
});

test("a window under maintenance is read with the page's own offset", () => {
  const status = parseUptimeKumaStatus(fixture("status-page"), fixture("heartbeat"), service);

  assert.deepEqual(status.maintenances, [
    {
      id: "2",
      name: "Database upgrade",
      status: "under-maintenance",
      startsAt: "2026-09-12T11:26:00.000Z",
      endsAt: "2026-09-12T13:26:00.000Z",
      // A Kuma page does not say which monitors a window covers.
      componentIds: [],
    },
  ]);
});

test("a window we cannot place on a clock is dropped", () => {
  const page = pageWith(ONE, {
    maintenanceList: [
      { id: 1, title: "Whenever", status: "under-maintenance", timeslotList: [{ startDate: null, endDate: null }] },
      { id: 2, title: "Never", status: "under-maintenance", timeslotList: [] },
    ],
  });

  assert.deepEqual(parseUptimeKumaStatus(page, beats({ "1": [1] }), service).maintenances, []);
});

test("a body that is not a Kuma payload at all throws", () => {
  assert.throws(() => parseUptimeKumaStatus(JSON.stringify([{ id: 1 }]), beats({}), service), /uptimekuma/);
  assert.throws(() => parseUptimeKumaStatus("not json", beats({}), service), /uptimekuma/);
});

test("a selected monitor is reported with the page's current name and status", () => {
  const status = parseUptimeKumaStatus(pageWith(ONE), beats({ "1": [0] }), {
    ...service,
    components: [
      { id: "1", name: "stored name" },
      { id: "gone", name: "Retired" },
    ],
  });

  assert.deepEqual(status.components, [
    { id: "1", name: "API", status: "major_outage" },
    // A selection the page no longer lists is unknown, never a recovery.
    { id: "gone", name: "Retired", status: "unknown" },
  ]);
});

test("a scoped provider reads its selection rather than the whole page", () => {
  const page = pageWith([...ONE, { id: 2, name: "Webhooks" }]);

  const status = parseUptimeKumaStatus(page, beats({ "1": [1], "2": [0] }), {
    ...service,
    components: [{ id: "1", name: "API" }],
    scopeToComponents: true,
  });

  assert.equal(status.overallStatus, "operational");
});

test("the monitor list carries each monitor's group as its group", () => {
  const components = parseUptimeKumaComponents(fixture("status-page"), fixture("heartbeat"), service);

  assert.deepEqual(components, [
    // Under maintenance when the fixture was recorded, which abstains.
    { id: "1", name: "API", group: "Services", showcase: false, status: "unknown" },
    { id: "2", name: "Webhooks", group: "Services", showcase: false, status: "major_outage" },
  ]);
});

test("a reading is one request per document, on the configured slug, asking for JSON", async () => {
  const seen: { url: string | undefined; accept: string | undefined }[] = [];

  await withServer(
    (req, res) => {
      seen.push({ url: req.url, accept: req.headers.accept });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.includes("heartbeat") === true ? fixture("heartbeat") : fixture("status-page"));
    },
    async (baseUrl) => {
      await uptimeKumaAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(seen.map((request) => request.url).sort(), [PAGE, HEARTBEAT].sort());
  assert.match(seen[0]?.accept ?? "", /application\/json/);
});

test("the slug is read out of the page url the operator pasted", async () => {
  const seen: (string | undefined)[] = [];

  await withServer(
    (req, res) => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.includes("heartbeat") === true ? fixture("heartbeat") : fixture("status-page"));
    },
    async (baseUrl) => {
      await uptimeKumaAdapter.fetchStatus(
        { id: "k", name: "K", baseUrl: `${baseUrl}/status/mystack` },
        { timeoutMs: 2000 },
      );
    },
  );

  assert.deepEqual(seen.sort(), ["/api/status-page/heartbeat/mystack", "/api/status-page/mystack"].sort());
});

test("a provider that names no slug reads Kuma's own default page", async () => {
  const seen: (string | undefined)[] = [];

  await withServer(
    (req, res) => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url?.includes("heartbeat") === true ? fixture("heartbeat") : fixture("status-page"));
    },
    async (baseUrl) => {
      await uptimeKumaAdapter.fetchStatus({ id: "k", name: "K", baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(seen.sort(), ["/api/status-page/default", "/api/status-page/heartbeat/default"].sort());
});
