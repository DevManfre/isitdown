import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isItDownAdapter, parseIsItDownComponents, parseIsItDownStatus } from "../../src/adapters/isitdown.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "peer", name: "Home lab", baseUrl: "https://peer.example.com" };
const fixture = readFileSync(new URL("../fixtures/isitdown/status.json", import.meta.url), "utf8");

runAdapterContract("isitdown", () => ({
  adapter: isItDownAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/status": fixture },
  degraded: { "/status": JSON.stringify({ providers: [{ id: "a", overallStatus: "operational" }] }) },
}));

test("the composite is the worst of the peer's enabled providers", () => {
  assert.equal(parseIsItDownStatus(fixture, service).overallStatus, "degraded");
});

test("a disabled peer provider does not count, and its unknown cannot drag the composite", () => {
  const only = JSON.stringify({ providers: [JSON.parse(fixture).providers[1], JSON.parse(fixture).providers[2]] });
  assert.equal(parseIsItDownStatus(only, service).overallStatus, "operational");
});

test("incidents and maintenance carry the provider's name and a unique id", () => {
  const status = parseIsItDownStatus(fixture, service);
  assert.deepEqual(status.activeIncidents.map((i) => [i.id, i.name, i.createdAt]), [
    ["github:inc1", "GitHub: Delayed webhooks", "2026-10-01T10:00:00.000Z"],
  ]);
  assert.deepEqual(status.maintenances.map((m) => [m.id, m.name]), [["cloudflare:m1", "Cloudflare: Edge upgrade"]]);
});

test("options.provider reads one peer provider, and names a missing one", () => {
  const one = parseIsItDownStatus(fixture, { ...service, options: { provider: "cloudflare" } });
  assert.equal(one.overallStatus, "operational");
  assert.throws(() => parseIsItDownStatus(fixture, { ...service, options: { provider: "nope" } }), /no enabled provider "nope"/);
});

test("scoping folds only the selected peer providers; a vanished one reads unknown", () => {
  const status = parseIsItDownStatus(fixture, {
    ...service,
    scopeToComponents: true,
    components: [{ id: "cloudflare", name: "Cloudflare" }, { id: "gone", name: "Gone" }],
  });
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.components.map((c) => [c.id, c.status]), [["cloudflare", "operational"], ["gone", "unknown"]]);
  assert.deepEqual(status.activeIncidents, []);
});

test("the picker lists the enabled peer providers", () => {
  assert.deepEqual(parseIsItDownComponents(fixture, service).map((c) => [c.id, c.status]), [
    ["github", "degraded"],
    ["cloudflare", "operational"],
  ]);
});
