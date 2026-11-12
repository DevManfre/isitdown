import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  datadogAdapter,
  parseDatadogComponents,
  parseDatadogHistory,
  parseDatadogStatus,
  parseDatadogUpdates,
} from "../../src/adapters/datadog.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "dnsimple", name: "DNSimple", baseUrl: "https://status.dnsimplestatus.com" };

// Recorded from status.dnsimplestatus.com/config.json (a Datadog Status Page).
const recorded = readFileSync(new URL("../fixtures/datadog/operational.json", import.meta.url), "utf8");

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The recorded page, edited: what it would say mid-incident. Nothing was open when it was recorded. */
function edited(change: (config: Json) => void): string {
  const config = JSON.parse(recorded) as Json;
  change(config);
  return JSON.stringify(config);
}

const component = (id: string, status: string): Json => ({ id, name: id.toUpperCase(), status, type: "Component" });

runAdapterContract("datadog", () => ({
  adapter: datadogAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/config.json": recorded },
  degraded: {
    "/config.json": JSON.stringify({
      components: [{ id: "c1" }],
      incidents: [{ id: "i1", componentsAffected: [{}], timeline: [{}] }],
      maintenances: null,
    }),
  },
}));

test("the recorded page reads operational, with nothing open", () => {
  const read = parseDatadogStatus(recorded, service);
  assert.equal(read.overallStatus, "operational");
  assert.deepEqual(read.activeIncidents, []);
  assert.deepEqual(read.maintenances, []);
});

test("a component's state is the reading: the worst one wins", () => {
  const body = JSON.stringify({ components: [component("a", "operational"), component("b", "partial_outage"), component("c", "degraded")] });
  assert.equal(parseDatadogStatus(body, service).overallStatus, "partial_outage");
});

test("a component under maintenance abstains rather than reading as operational or down", () => {
  const body = JSON.stringify({ components: [component("a", "maintenance")] });
  assert.equal(parseDatadogStatus(body, service).overallStatus, "unknown");
});

test("a state nobody has seen reads as the worst case", () => {
  const body = JSON.stringify({ components: [component("a", "on_fire")] });
  assert.equal(parseDatadogStatus(body, service).overallStatus, "major_outage");
});

test("a component nested in a group is read too", () => {
  const body = JSON.stringify({
    components: [{ id: "g", name: "Web", type: "ComponentGroup", components: [component("a", "major_outage")] }],
  });
  assert.equal(parseDatadogStatus(body, service).overallStatus, "major_outage");
});

test("an open incident is reported, with its worst affected word as impact and its publication as createdAt", () => {
  const body = edited((config) => {
    const incident = config["incidents"][0];
    incident.resolved = false;
    incident.currentStatus = "investigating";
    incident.componentsAffected = [
      { id: "x", status: "degraded" },
      { id: "y", status: "partial_outage" },
    ];
  });
  const read = parseDatadogStatus(body, service);
  const incident = JSON.parse(recorded).incidents[0];
  assert.deepEqual(read.activeIncidents, [
    {
      id: incident.id,
      name: incident.title,
      impact: "partial_outage",
      status: "investigating",
      updatedAt: incident.lastModifiedAt,
      createdAt: incident.publishedDate,
    },
  ]);
});

test("an open incident is trouble even while every component still reads operational", () => {
  const body = edited((config) => {
    config["incidents"][0].resolved = false;
    config["incidents"][0].currentStatus = "investigating";
  });
  assert.equal(parseDatadogStatus(body, service).overallStatus, "degraded");
});

test("a scheduled or running maintenance window is kept, a completed one dropped", () => {
  const body = JSON.stringify({
    components: [component("a", "operational")],
    maintenances: [
      { id: "m1", title: "DNS work", currentStatus: "in_progress", startDate: "2026-11-12T10:00:00Z", completedDate: "2026-11-12T12:00:00Z", componentsAffected: [{ id: "a" }] },
      { id: "m2", title: "Done", currentStatus: "completed", startDate: "2026-11-01T10:00:00Z" },
    ],
  });
  assert.deepEqual(parseDatadogStatus(body, service).maintenances, [
    { id: "m1", name: "DNS work", status: "in_progress", startsAt: "2026-11-12T10:00:00.000Z", endsAt: "2026-11-12T12:00:00.000Z", componentIds: ["a"] },
  ]);
});

test("scoping folds only the selected components and drops incidents on unselected ones", () => {
  const body = JSON.stringify({
    components: [component("a", "operational"), component("b", "major_outage")],
    incidents: [
      { id: "on-b", title: "B down", currentStatus: "identified", resolved: false, componentsAffected: [{ id: "b", status: "major_outage" }] },
      { id: "page-wide", title: "Everything", currentStatus: "investigating", resolved: false, componentsAffected: [] },
    ],
  });
  const read = parseDatadogStatus(body, { ...service, scopeToComponents: true, components: [{ id: "a", name: "A" }] });
  assert.deepEqual(read.components, [{ id: "a", name: "A", status: "operational" }]);
  assert.deepEqual(read.activeIncidents.map((incident) => incident.id), ["page-wide"]);
  // The page-wide incident still floors the reading.
  assert.equal(read.overallStatus, "degraded");
});

test("a selected component the page no longer lists reads unknown", () => {
  const read = parseDatadogStatus(recorded, { ...service, components: [{ id: "gone", name: "Gone" }] });
  assert.deepEqual(read.components, [{ id: "gone", name: "Gone", status: "unknown" }]);
});

test("the picker lists leaf components with their group, never the group itself", () => {
  const previews = parseDatadogComponents(recorded, service);
  const website = previews.find((preview) => preview.name === "Website");
  assert.deepEqual(website, { id: "50a47ab3-98ec-4374-822b-cb703cdd1359", name: "Website", group: "Production Web", showcase: false, status: "operational" });
  assert.equal(previews.some((preview) => preview.name === "Production Web"), false);
  assert.equal(previews.find((preview) => preview.name === "Registrar")?.group, null);
});

test("the history holds every recorded incident, resolved, back to the oldest one", () => {
  const history = parseDatadogHistory(recorded, service);
  const raw = JSON.parse(recorded).incidents as Json[];
  assert.equal(history.incidents.length, raw.length);
  assert.ok(history.incidents.every((incident) => incident.resolvedAt !== null));
  const oldest = raw.map((incident) => new Date(incident["publishedDate"]).toISOString()).sort()[0];
  assert.equal(history.coverageStart, oldest);
});

test("an incident's updates are its timeline, oldest first", () => {
  const incident = JSON.parse(recorded).incidents[0] as Json;
  const updates = parseDatadogUpdates(recorded, incident["id"], service);
  assert.equal(updates.length, incident["timeline"].length);
  assert.deepEqual(updates.map((update) => update.at), [...updates.map((update) => update.at)].sort());
  assert.equal(updates.at(-1)?.status, "resolved");
  assert.deepEqual(parseDatadogUpdates(recorded, "no-such-incident", service), []);
});

test("a document that is not a Datadog status page config throws", () => {
  assert.throws(() => parseDatadogStatus("<html></html>", service), /not JSON/);
  assert.throws(() => parseDatadogStatus(JSON.stringify({ page: {} }), service), /not a Datadog status page config/);
});
