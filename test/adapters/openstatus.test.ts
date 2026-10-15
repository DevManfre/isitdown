import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { endpointOf, openStatusAdapter, parseOpenStatus } from "../../src/adapters/openstatus.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "os", name: "OpenStatus", baseUrl: "https://openstatus.openstatus.dev" };
// Recorded from api.openstatus.dev/public/status/openstatus.
const fixture = readFileSync(new URL("../fixtures/openstatus/public.json", import.meta.url), "utf8");
const word = (status: string): string => JSON.stringify({ status });

runAdapterContract("openstatus", () => ({
  adapter: openStatusAdapter,
  service: (baseUrl) => ({ ...service, options: { apiBase: baseUrl, slug: "demo" } }),
  ok: { "/public/status/demo": fixture },
  degraded: { "/public/status/demo": fixture },
}));

test("OpenStatus's words map onto the normalized vocabulary", () => {
  const read = (s: string) => parseOpenStatus(word(s), service).overallStatus;
  assert.equal(read("operational"), "operational");
  assert.equal(read("degraded_performance"), "degraded");
  assert.equal(read("partial_outage"), "partial_outage");
  assert.equal(read("major_outage"), "major_outage");
  assert.equal(read("incident"), "partial_outage");
  assert.equal(read("under_maintenance"), "unknown");
  assert.equal(read("brand_new_word"), "major_outage");
});

test("the slug comes from options, else from the page's host", () => {
  assert.equal(endpointOf(service), "https://api.openstatus.dev/public/status/openstatus");
  assert.equal(endpointOf({ ...service, options: { slug: "acme" } }), "https://api.openstatus.dev/public/status/acme");
});
