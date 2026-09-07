import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  instatusAdapter,
  parseInstatusComponents,
  parseInstatusSummary,
} from "../../src/adapters/instatus.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "gcore",
  name: "Gcore",
  baseUrl: "https://status.gcore.com",
};

/**
 * Recorded from live Instatus pages (`npm run record-fixture`):
 * `operational.json` and `components.json` from Gcore's page (the component
 * list truncated to its first six entries), `incident.json` from Instatus's own
 * demo page, which keeps two incidents open permanently.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/instatus/${name}.json`, import.meta.url), "utf8");

/** A `/summary.json` body built around one entry, for cases a fixture would bury. */
const summaryWith = (page: string, entries: { incidents?: unknown[]; maintenances?: unknown[] } = {}): string =>
  JSON.stringify({
    page: { name: "Test", url: "https://status.example.com", status: page },
    activeIncidents: entries.incidents ?? [],
    activeMaintenances: entries.maintenances ?? [],
  });

const incident = (impact: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "i1",
  name: "Something is wrong",
  started: "2026-09-01T08:00:00.000Z",
  status: "INVESTIGATING",
  impact,
  updatedAt: "2026-09-01T09:00:00.000Z",
  ...extra,
});

runAdapterContract("instatus", () => ({
  adapter: instatusAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: {
    "/summary.json": fixture("incident"),
    "/v3/components.json": fixture("components"),
  },
  // Nothing but the ids an incident and a component are identifiable by.
  degraded: {
    "/summary.json": JSON.stringify({ activeIncidents: [{ id: "i1" }] }),
    "/v3/components.json": JSON.stringify({ components: [{ id: "c1" }] }),
  },
}));

test("open incidents decide the reading, worst first", () => {
  const status = parseInstatusSummary(fixture("incident"), service);

  assert.equal(status.provider, "gcore");
  assert.equal(status.overallStatus, "partial_outage");
  assert.deepEqual(status.activeIncidents, [
    {
      id: "clq3wc2ap1350bronl8974nko",
      name: "partial",
      impact: "PARTIALOUTAGE",
      status: "INVESTIGATING",
      updatedAt: "2025-10-04T17:08:17.917Z",
    },
    {
      id: "clq3wa0jh18301b7ogv9747apy",
      name: "degraded",
      impact: "DEGRADEDPERFORMANCE",
      status: "INVESTIGATING",
      updatedAt: "2025-10-04T17:08:17.528Z",
    },
  ]);
});

test("a page that is up with nothing open reads operational", () => {
  const status = parseInstatusSummary(fixture("operational"), service);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

const impacts: { impact: string; expected: string }[] = [
  { impact: "DEGRADEDPERFORMANCE", expected: "degraded" },
  { impact: "PARTIALOUTAGE", expected: "partial_outage" },
  { impact: "MAJOROUTAGE", expected: "major_outage" },
];

for (const { impact, expected } of impacts) {
  test(`an incident with impact ${impact} reads as ${expected}`, () => {
    const body = summaryWith("HASISSUES", { incidents: [incident(impact)] });
    assert.equal(parseInstatusSummary(body, service).overallStatus, expected);
  });
}

test("an impact word nothing knows is treated as the worst case, never as calm", () => {
  const body = summaryWith("UP", { incidents: [incident("CATASTROPHE")] });
  assert.equal(parseInstatusSummary(body, service).overallStatus, "major_outage");
});

test("an open incident outweighs a page still saying UP", () => {
  const body = summaryWith("UP", { incidents: [incident("MAJOROUTAGE")] });
  assert.equal(parseInstatusSummary(body, service).overallStatus, "major_outage");
});

test("a page saying HASISSUES with nothing listed still reads as trouble", () => {
  // The floor exists for exactly this: a page that has not published the
  // incident yet must not read as calm.
  assert.equal(parseInstatusSummary(summaryWith("HASISSUES"), service).overallStatus, "degraded");
});

test("a page under maintenance abstains rather than claiming to be up", () => {
  assert.equal(parseInstatusSummary(summaryWith("UNDERMAINTENANCE"), service).overallStatus, "unknown");
});

test("an entry with no id is dropped: nothing downstream could track it", () => {
  const body = summaryWith("HASISSUES", { incidents: [{ impact: "MAJOROUTAGE", name: "no id" }] });
  const status = parseInstatusSummary(body, service);

  assert.deepEqual(status.activeIncidents, []);
  // The page's own word survives the drop, so the provider does not read calm.
  assert.equal(status.overallStatus, "degraded");
});

test("a declared window carries an end derived from the length Instatus publishes", () => {
  const status = parseInstatusSummary(fixture("operational"), service);

  assert.deepEqual(status.maintenances[0], {
    id: "cmtlnoty400tz1bk3ehvx261c",
    name: "[Scheduled] Cloud | Chicago Maintenance",
    status: "NOTSTARTEDYET",
    startsAt: "2026-09-10T08:00:00.000Z",
    // 15 minutes after the start; the payload publishes no end timestamp.
    endsAt: "2026-09-10T08:15:00.000Z",
    componentIds: [],
  });
});

test("a window with no length has no end rather than an invented one", () => {
  const body = summaryWith("UP", {
    maintenances: [{ id: "m1", name: "Work", start: "2026-09-10T08:00:00.000Z", status: "INPROGRESS" }],
  });

  assert.equal(parseInstatusSummary(body, service).maintenances[0]?.endsAt, null);
});

test("a completed window is dropped: it can no longer silence anything", () => {
  const body = summaryWith("UP", {
    maintenances: [
      { id: "m1", name: "Work", start: "2026-09-01T08:00:00.000Z", status: "COMPLETED", duration: 30 },
    ],
  });

  assert.deepEqual(parseInstatusSummary(body, service).maintenances, []);
});

test("a body that is not this provider's payload at all throws", () => {
  assert.throws(() => parseInstatusSummary(JSON.stringify([{ id: 1 }]), service), /instatus/);
  assert.throws(() => parseInstatusSummary("not json", service), /instatus/);
});

test("the component list carries each component's group and current status", () => {
  const components = parseInstatusComponents(fixture("components"), service);
  const api = components.find((component) => component.id === "cm7vpd2v800iesfcpnskdkma4");

  assert.deepEqual(api, {
    id: "cm7vpd2v800iesfcpnskdkma4",
    name: "API",
    group: "Gcore Systems",
    showcase: false,
    status: "operational",
  });
  // An ungrouped component reports no group rather than an empty string.
  assert.equal(components.find((component) => component.group === null)?.name, "Gcore Systems");
});

test("no selection means no component request at all", async () => {
  const seen: (string | undefined)[] = [];

  await withServer(
    (req, res) => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture("operational"));
    },
    async (baseUrl) => {
      await instatusAdapter.fetchStatus({ ...service, baseUrl }, { timeoutMs: 2000 });
    },
  );

  assert.deepEqual(seen, ["/summary.json"], "the second endpoint is only worth a request with a selection");
});

test("a selection is resolved against the component list and reported", async () => {
  let status: Awaited<ReturnType<typeof instatusAdapter.fetchStatus>> | undefined;

  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url === "/v3/components.json" ? fixture("components") : fixture("operational"));
    },
    async (baseUrl) => {
      status = await instatusAdapter.fetchStatus(
        {
          ...service,
          baseUrl,
          components: [
            { id: "cm7vpd2v800iesfcpnskdkma4", name: "stored name" },
            { id: "gone", name: "Retired component" },
          ],
        },
        { timeoutMs: 2000 },
      );
    },
  );

  assert.deepEqual(status?.components, [
    // The provider's current name wins over the one stored at selection time.
    { id: "cm7vpd2v800iesfcpnskdkma4", name: "API", status: "operational" },
    // A component the page no longer lists is unknown, never a recovery.
    { id: "gone", name: "Retired component", status: "unknown" },
  ]);
});

test("a scoped provider reads its selection, not the page's own word", async () => {
  let status: Awaited<ReturnType<typeof instatusAdapter.fetchStatus>> | undefined;

  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        req.url === "/v3/components.json"
          ? JSON.stringify({ components: [{ id: "c1", name: "API", status: "MAJOROUTAGE" }] })
          : summaryWith("UP"),
      );
    },
    async (baseUrl) => {
      status = await instatusAdapter.fetchStatus(
        { ...service, baseUrl, components: [{ id: "c1", name: "API" }], scopeToComponents: true },
        { timeoutMs: 2000 },
      );
    },
  );

  assert.equal(status?.overallStatus, "major_outage");
});

test("scoping never silences an incident: Instatus does not attribute them to components", async () => {
  // Documented limitation of the payload, and the safe direction: a scoped
  // provider going quiet about an outage is the failure worth avoiding.
  let status: Awaited<ReturnType<typeof instatusAdapter.fetchStatus>> | undefined;

  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        req.url === "/v3/components.json"
          ? JSON.stringify({ components: [{ id: "c1", name: "API", status: "OPERATIONAL" }] })
          : summaryWith("HASISSUES", { incidents: [incident("MAJOROUTAGE")] }),
      );
    },
    async (baseUrl) => {
      status = await instatusAdapter.fetchStatus(
        { ...service, baseUrl, components: [{ id: "c1", name: "API" }], scopeToComponents: true },
        { timeoutMs: 2000 },
      );
    },
  );

  assert.deepEqual(
    status?.activeIncidents.map((entry) => entry.id),
    ["i1"],
  );
  assert.equal(status?.overallStatus, "operational", "the reading is the selection's");
});

test("the adapter offers no incident history: Instatus publishes no JSON for one", () => {
  assert.equal(instatusAdapter.fetchIncidentHistory, undefined);
});
