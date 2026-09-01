import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseSummary,
  parseIncidentHistory,
  parseComponentList,
  statuspageAdapter,
} from "../../src/adapters/statuspage.adapter.ts";
import { getAdapter } from "../../src/adapters/index.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "github",
  name: "GitHub",
  baseUrl: "https://www.githubstatus.com",
};

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/statuspage/${name}.json`, import.meta.url), "utf8"));

const fixtureText = (name: string): string =>
  readFileSync(new URL(`../fixtures/statuspage/${name}.json`, import.meta.url), "utf8");

runAdapterContract("statuspage", () => ({
  adapter: statuspageAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: {
    "/api/v2/summary.json": fixtureText("incident-minor"),
    "/api/v2/incidents.json": fixtureText("incidents-history"),
  },
  // Every field Statuspage marks optional, gone: only the two keys the shape is
  // recognised by survive.
  degraded: {
    "/api/v2/summary.json": JSON.stringify({ status: {}, incidents: [{ id: "i1" }], components: [{ id: "c1" }] }),
    "/api/v2/incidents.json": JSON.stringify({ incidents: [{ id: "h1", created_at: "2026-01-01T00:00:00.000Z" }] }),
  },
}));

test("an operational summary maps to operational with no incidents", () => {
  const status = parseSummary(fixture("operational"), service);
  assert.equal(status.provider, "github");
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
  assert.ok(!Number.isNaN(Date.parse(status.fetchedAt)));
});

test("indicator minor maps to degraded and surfaces the incident as recorded", () => {
  const status = parseSummary(fixture("incident-minor"), service);
  assert.equal(status.overallStatus, "degraded");
  assert.equal(status.activeIncidents.length, 1);
  assert.deepEqual(status.activeIncidents[0], {
    id: "46j9vvprj159",
    name: "Workers AI GLM 5.2 is unavailable",
    impact: "minor",
    status: "monitoring",
    updatedAt: "2026-08-19T16:16:18.869Z",
  });
});

test("indicator major maps to partial_outage", () => {
  const status = parseSummary(fixture("incident-major"), service);
  assert.equal(status.overallStatus, "partial_outage");
  assert.equal(status.activeIncidents[0]?.impact, "major");
  assert.equal(status.activeIncidents[0]?.status, "investigating");
});

test("a resolved incident is not an active incident", () => {
  const status = parseSummary(fixture("resolved"), service);
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("a postmortem incident is not an active incident either", () => {
  const status = parseSummary(
    { status: { indicator: "none" }, incidents: [{ id: "p1", status: "postmortem" }] },
    service,
  );
  assert.deepEqual(status.activeIncidents, []);
});

test("an unrecognised indicator maps to the more severe bucket, never operational", () => {
  const status = parseSummary(fixture("unknown-indicator"), service);
  assert.equal(status.overallStatus, "major_outage");
});

test("each documented indicator maps to its bucket", () => {
  const expected = {
    none: "operational",
    minor: "degraded",
    major: "partial_outage",
    critical: "major_outage",
  } as const;
  for (const [indicator, bucket] of Object.entries(expected)) {
    const status = parseSummary({ status: { indicator }, incidents: [] }, service);
    assert.equal(status.overallStatus, bucket, `indicator ${indicator}`);
  }
});

test("a summary with incidents but no status object is unknown, not operational", () => {
  const status = parseSummary({ incidents: [] }, service);
  assert.equal(status.overallStatus, "unknown");
});

test("a malformed incident degrades field by field instead of throwing", () => {
  const status = parseSummary(fixture("malformed"), service);
  assert.equal(status.overallStatus, "degraded");
  assert.equal(status.activeIncidents.length, 1);
  assert.equal(status.activeIncidents[0]?.name, "");
  assert.equal(status.activeIncidents[0]?.impact, "");
  assert.ok(!Number.isNaN(Date.parse(status.activeIncidents[0]?.updatedAt ?? "")));
});

test("an incident with no usable id is dropped rather than keyed on undefined", () => {
  const status = parseSummary(
    { status: { indicator: "minor" }, incidents: [{ status: "investigating" }, { id: "ok", status: "identified" }] },
    service,
  );
  assert.deepEqual(
    status.activeIncidents.map((incident) => incident.id),
    ["ok"],
  );
});

test("a fundamentally broken body throws so the poller can retry", () => {
  for (const body of ["not json at all", 42, null, [], { nothing: true }]) {
    assert.throws(() => parseSummary(body, service), `expected ${JSON.stringify(body)} to throw`);
  }
});

test("the provider id comes from the service, not from the payload", () => {
  const status = parseSummary(fixture("operational"), { ...service, id: "renamed" });
  assert.equal(status.provider, "renamed");
});

const withSelection = (components: { id: string; name: string }[]): ServiceRef => ({
  ...service,
  components,
});

test("no selection yields no components even when the payload has them", () => {
  const status = parseSummary(fixture("components-mixed"), service);
  assert.deepEqual(status.components, []);
});

test("selected components are mapped in selection order with payload names", () => {
  const status = parseSummary(
    fixture("components-mixed"),
    withSelection([
      { id: "cmp2", name: "Old Dashboard Name" },
      { id: "cmp1", name: "API" },
    ]),
  );
  assert.deepEqual(status.components, [
    { id: "cmp2", name: "Dashboard", status: "degraded" },
    { id: "cmp1", name: "API", status: "operational" },
  ]);
});

test("component status words map onto the normalized vocabulary", () => {
  const status = parseSummary(
    fixture("components-mixed"),
    withSelection([
      { id: "cmp3", name: "Webhooks" },
      { id: "cmp4", name: "Batch Jobs" },
      { id: "cmp5", name: "Edge Cache" },
    ]),
  );
  assert.deepEqual(
    status.components.map((component) => component.status),
    ["partial_outage", "unknown", "major_outage"],
  );
});

test("a selected component missing from the payload reads unknown with the snapshot name", () => {
  const status = parseSummary(fixture("components-mixed"), withSelection([{ id: "gone", name: "Removed Thing" }]));
  assert.deepEqual(status.components, [{ id: "gone", name: "Removed Thing", status: "unknown" }]);
});

const EUROPE = [{ id: "ams", name: "Amsterdam, Netherlands - (AMS)" }];

const scopedTo = (components: { id: string; name: string }[]): ServiceRef => ({
  ...service,
  components,
  scopeToComponents: true,
});

test("scoping to components drops an incident that touches none of them", () => {
  const status = parseSummary(fixture("regional"), scopedTo(EUROPE));
  assert.deepEqual(
    status.activeIncidents.map((incident) => incident.id),
    ["inc-europe", "inc-page"],
  );
});

test("an incident with no component attribution is page-wide and always kept", () => {
  const status = parseSummary(fixture("regional"), scopedTo([{ id: "nowhere", name: "Nowhere" }]));
  assert.deepEqual(
    status.activeIncidents.map((incident) => incident.id),
    ["inc-page"],
  );
});

test("without scoping every incident is reported, whatever the selection", () => {
  const status = parseSummary(fixture("regional"), withSelection(EUROPE));
  assert.deepEqual(
    status.activeIncidents.map((incident) => incident.id),
    ["inc-asia", "inc-europe", "inc-page"],
  );
});

test("a scoped overall status is the worst selected component, not the page indicator", () => {
  const europe = parseSummary(fixture("regional"), scopedTo(EUROPE));
  // The page indicator is `minor`; Amsterdam alone is operational.
  assert.equal(europe.overallStatus, "operational");

  const both = parseSummary(fixture("regional"), scopedTo([...EUROPE, { id: "sin", name: "Singapore - (SIN)" }]));
  assert.equal(both.overallStatus, "partial_outage");
});

test("a scoped overall status is unknown when no selected component reports one", () => {
  const status = parseSummary(fixture("regional"), scopedTo([{ id: "nowhere", name: "Nowhere" }]));
  // Never operational: the diff engine must not read a dropped component as a recovery.
  assert.equal(status.overallStatus, "unknown");
});

test("scoping with an empty selection leaves the page status and incidents alone", () => {
  const status = parseSummary(fixture("regional"), { ...service, components: [], scopeToComponents: true });
  assert.equal(status.overallStatus, "degraded");
  assert.equal(status.activeIncidents.length, 3);
});

test("scoping filters incident history the same way, so charts match notifications", () => {
  const scoped = parseIncidentHistory(fixture("regional-history"), scopedTo(EUROPE));
  assert.deepEqual(
    scoped.incidents.map((incident) => incident.id),
    ["inc-europe", "inc-page"],
  );

  const unscoped = parseIncidentHistory(fixture("regional-history"), withSelection(EUROPE));
  assert.equal(unscoped.incidents.length, 3);
});

test("fetchStatus requests the summary endpoint under the service base url", async () => {
  const seen: string[] = [];
  await withServer(
    (req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { indicator: "none" }, incidents: [] }));
    },
    async (baseUrl) => {
      const status = await statuspageAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
      assert.equal(status.overallStatus, "operational");
      assert.deepEqual(seen, ["/api/v2/summary.json"]);
    },
  );
});

test("fetchStatus follows a redirect, as status.anthropic.com issues one", async () => {
  await withServer(
    (req, res) => {
      if (req.url === "/api/v2/summary.json") {
        res.writeHead(301, { location: "/moved/summary.json" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { indicator: "minor" }, incidents: [] }));
    },
    async (baseUrl) => {
      const status = await statuspageAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
      assert.equal(status.overallStatus, "degraded");
    },
  );
});

test("fetchStatus throws on a non-2xx response with the status code in the message", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503);
      res.end("nope");
    },
    async (baseUrl) => {
      await assert.rejects(
        statuspageAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 }),
        /503/,
      );
    },
  );
});

test("fetchStatus throws when the body is not JSON", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json</html>");
    },
    async (baseUrl) => {
      await assert.rejects(statuspageAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 }));
    },
  );
});

test("fetchStatus gives up once the timeout passes", async () => {
  await withServer(
    () => {
      /* never responds */
    },
    async (baseUrl) => {
      await assert.rejects(statuspageAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 150 }));
    },
  );
});

test("the registry resolves statuspage and rejects an unknown adapter by name", () => {
  assert.equal(getAdapter("statuspage").id, "statuspage");
  assert.throws(() => getAdapter("nope"), /nope/);
});

test("incident history maps every entry with its start and resolution", () => {
  const result = parseIncidentHistory(fixture("incidents-history"), service);
  assert.equal(result.incidents.length, 3);
  assert.deepEqual(result.incidents[1], {
    id: "hist-major",
    name: "API errors",
    impact: "major",
    status: "resolved",
    startedAt: "2026-08-10T10:00:00.000Z",
    resolvedAt: "2026-08-10T12:30:00.000Z",
    updatedAt: "2026-08-10T12:30:00.000Z",
  });
});

test("an open incident keeps a null resolvedAt", () => {
  const result = parseIncidentHistory(fixture("incidents-history"), service);
  assert.equal(result.incidents[0]?.resolvedAt, null);
});

test("a closed incident without resolved_at falls back to updated_at", () => {
  const result = parseIncidentHistory(fixture("incidents-history"), service);
  assert.equal(result.incidents[2]?.resolvedAt, "2026-07-28T09:00:00.000Z");
});

test("under the feed cap the coverage is the full history", () => {
  const result = parseIncidentHistory(fixture("incidents-history"), service);
  assert.equal(result.coverageStart, null);
});

test("at the feed cap the coverage starts at the oldest entry", () => {
  const incidents = Array.from({ length: 50 }, (_, i) => ({
    id: `cap-${i}`,
    name: `Incident ${i}`,
    status: "resolved",
    impact: "minor",
    created_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    updated_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T01:00:00.000Z`,
    resolved_at: `2026-06-${String((i % 28) + 1).padStart(2, "0")}T01:00:00.000Z`,
  }));
  const result = parseIncidentHistory({ incidents }, service);
  assert.equal(result.coverageStart, "2026-06-01T00:00:00.000Z");
});

test("a history entry without id or created_at is dropped", () => {
  const result = parseIncidentHistory(
    {
      incidents: [
        { name: "no id", status: "resolved", created_at: "2026-08-01T00:00:00.000Z" },
        { id: "no-created", name: "no created_at", status: "resolved" },
        { id: "kept", status: "resolved", created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T01:00:00.000Z" },
      ],
    },
    service,
  );
  assert.deepEqual(result.incidents.map((incident) => incident.id), ["kept"]);
});

test("a fundamentally broken history body throws so the caller can skip the provider", () => {
  for (const body of ["not json at all", 42, null, [], { nothing: true }]) {
    assert.throws(() => parseIncidentHistory(body, service), `expected ${JSON.stringify(body)} to throw`);
  }
});

test("fetchIncidentHistory requests the incidents endpoint under the service base url", async () => {
  const seen: string[] = [];
  await withServer(
    (req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ incidents: [] }));
    },
    async (baseUrl) => {
      const result = await statuspageAdapter.fetchIncidentHistory?.({ ...service, baseUrl }, { timeoutMs: 2000 });
      assert.deepEqual(result, { incidents: [], coverageStart: null });
      assert.deepEqual(seen, ["/api/v2/incidents.json"]);
    },
  );
});

test("fetchIncidentHistory throws on a non-2xx response", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(503);
      res.end("nope");
    },
    async (baseUrl) => {
      await assert.rejects(
        statuspageAdapter.fetchIncidentHistory!({ ...service, baseUrl }, { timeoutMs: 2000 }),
        /503/,
      );
    },
  );
});

test("parseComponentList excludes group containers and resolves group labels", () => {
  const previews = parseComponentList(fixture("components-mixed"), service);
  assert.deepEqual(previews, [
    { id: "cmp1", name: "API", group: "Core Services", showcase: true, status: "operational" },
    { id: "cmp2", name: "Dashboard", group: "Core Services", showcase: true, status: "degraded" },
    { id: "cmp3", name: "Webhooks", group: null, showcase: false, status: "partial_outage" },
    { id: "cmp4", name: "Batch Jobs", group: null, showcase: false, status: "unknown" },
    { id: "cmp5", name: "Edge Cache", group: null, showcase: false, status: "major_outage" },
  ]);
});

test("listComponents fetches the summary over HTTP", async () => {
  await withServer(
    (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(fixture("components-mixed")));
    },
    async (baseUrl) => {
      const previews = await statuspageAdapter.listComponents?.(
        { id: "fixture", name: "Fixture", baseUrl },
        { timeoutMs: 2000 },
      );
      assert.equal(previews?.length, 5);
      assert.equal(previews?.[0]?.id, "cmp1");
    },
  );
});

test("listComponents throws on a non-2xx response", async () => {
  await withServer(
    (_req, res) => {
      res.statusCode = 500;
      res.end("nope");
    },
    async (baseUrl) => {
      await assert.rejects(
        statuspageAdapter.listComponents?.({ id: "fixture", name: "Fixture", baseUrl }, { timeoutMs: 2000 }) ??
          Promise.reject(new Error("listComponents missing")),
        /HTTP 500/,
      );
    },
  );
});

test("parseComponentList carries each component's current status", () => {
  const list = parseComponentList(fixture("components-mixed"), service);
  assert.ok(list.length > 0);
  for (const component of list) {
    assert.ok(
      ["operational", "degraded", "partial_outage", "major_outage", "unknown"].includes(component.status),
      `${component.name} had status ${component.status}`,
    );
  }
});

test("parseComponentList maps an unrecognised status word to major_outage", () => {
  // Not "unknown": `mapComponentStatus` ends in `?? "major_outage"`
  // (statuspage.adapter.ts:114), a deliberate fail-loud choice — a status word
  // the adapter does not recognise is treated as worst-case, never as benign.
  // Reusing that mapper is the point of this task, so this test pins its real
  // behaviour rather than a second, kinder mapping.
  const list = parseComponentList(
    { components: [{ id: "a", name: "Thing", status: "not_a_real_status" }] },
    { id: "x", name: "X", baseUrl: "https://example.com" },
  );
  assert.equal(list[0]?.status, "major_outage");
});
