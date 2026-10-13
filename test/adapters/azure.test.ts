import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { azureAdapter, parseAzureHistory, parseAzureStatus } from "../../src/adapters/azure.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { resetValidators } from "../../src/core/http.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = {
  id: "azure",
  name: "Azure",
  baseUrl: "https://azure.status.microsoft",
};

/**
 * `operational.xml` is the live feed recorded as it stands while Azure is
 * healthy: the envelope and no entries at all. The feed carries open
 * communications only, so there was no incident to record — `incident.xml` and
 * `resolved.xml` are that same recorded envelope with entries in the documented
 * shape (title, HTML description, category, pubDate, guid) added.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/azure/${name}.xml`, import.meta.url), "utf8");

const now = new Date("2026-09-07T12:00:00.000Z");

runAdapterContract("azure", () => ({
  adapter: azureAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/en-us/status/feed/": fixture("incident") },
  // An entry with nothing but the guid everything downstream tracks it by.
  degraded: {
    "/en-us/status/feed/": fixture("incident").replace(
      /<item>[\s\S]*<\/item>/,
      "<item><guid>ONLY-AN-ID</guid></item>",
    ),
  },
}));

test("an open communication is reported, with its severity read from the wording", () => {
  const status = parseAzureStatus(fixture("incident"), service, now);

  assert.equal(status.provider, "azure");
  assert.equal(status.activeIncidents.length, 2);
  const issue = status.activeIncidents.find((incident) => incident.id === "ABCD-1234-WEU");
  assert.match(issue!.name, /West Europe/);
  assert.equal(issue!.updatedAt, "2026-09-07T09:35:00.000Z");
  // "failures or timeouts" for a subset of customers is not a full outage.
  assert.notEqual(status.overallStatus, "operational");
});

test("the empty feed Azure publishes while healthy reads as operational", () => {
  const status = parseAzureStatus(fixture("operational"), service, now);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("Azure's own word for a closure — mitigated — ends the incident", () => {
  // The generic feed adapter's vocabulary has no "mitigated", which is why this
  // adapter exists rather than the feed one being pointed at the same URL.
  const status = parseAzureStatus(fixture("resolved"), service, now);

  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("an entry older than the active window stops counting as current", () => {
  const stale = new Date("2026-09-10T12:00:00.000Z");

  const status = parseAzureStatus(fixture("incident"), service, stale);

  assert.equal(status.overallStatus, "operational");
});

test("the history reports what the feed still carries, mitigations included", () => {
  const history = parseAzureHistory(fixture("resolved"), service);

  assert.equal(history.incidents.length, 1);
  assert.equal(history.incidents[0]?.status, "mitigated");
  assert.equal(history.incidents[0]?.resolvedAt, "2026-09-07T11:10:00.000Z");
  assert.equal(history.coverageStart, "2026-09-07T11:10:00.000Z");
});

test("a body that is not a feed rejects rather than reading as calm", () => {
  assert.throws(() => parseAzureStatus("<html>not a feed</html>", service, now), /not RSS or Atom/);
});

test("the locale option decides which feed is read", async () => {
  resetValidators();
  const paths: string[] = [];
  await withServer(
    (req, res) => {
      paths.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(fixture("operational"));
    },
    async (baseUrl) => {
      await azureAdapter.fetchStatus({ ...service, baseUrl, options: { locale: "it-it" } }, { timeoutMs: 2000 });
      assert.deepEqual(paths, ["/it-it/status/feed/"]);
    },
  );
});

test("regions and services are read off the title (roadmap 2.8)", () => {
  const raw = fixture("incident");
  const open = (options: Record<string, string>): string[] =>
    parseAzureStatus(raw, { ...service, options }, now).activeIncidents.map((entry) => entry.id);

  assert.deepEqual(open({ regions: "westeurope" }).sort(), ["ABCD-1234-WEU", "EFGH-5678-GLOBAL"], "the API name matches the display name; Global always passes");
  assert.deepEqual(open({ regions: "North Europe" }), ["EFGH-5678-GLOBAL"]);
  // The AKS advisory names its service; "Multiple Services" says nothing about
  // which, so no service filter may hide it.
  assert.deepEqual(open({ services: "Azure Kubernetes Service" }).sort(), ["ABCD-1234-WEU", "EFGH-5678-GLOBAL"]);
  assert.deepEqual(open({ services: "Cosmos DB" }), ["ABCD-1234-WEU"]);
});
