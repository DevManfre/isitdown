import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cStateAdapter, parseCState, parseCStateComponents } from "../../src/adapters/cstate.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "cstate", name: "cState", baseUrl: "https://status.example.com" };
// `index.json` is recorded from cstate.mnts.lt; `disrupted.json` is the same
// document with two systems disrupted and an unresolved issue in cState's own
// issue shape (title, createdAt, lastMod, permalink, severity).
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/cstate/${name}.json`, import.meta.url), "utf8");

runAdapterContract("cstate", () => ({
  adapter: cStateAdapter,
  service: (baseUrl) => ({ ...service, baseUrl }),
  ok: { "/index.json": fixture("index") },
  degraded: { "/index.json": JSON.stringify({ systems: [{ name: "API" }] }) },
}));

test("the recorded page reads operational with no incident", () => {
  const read = parseCState(fixture("index"), service);
  assert.equal(read.overallStatus, "operational");
  assert.deepEqual(read.activeIncidents, []);
});

test("a disrupted page reads degraded, and an issue listed by two systems is one incident", () => {
  const read = parseCState(fixture("disrupted"), service);
  assert.equal(read.overallStatus, "degraded");
  assert.deepEqual(read.activeIncidents.map((i) => [i.name, i.impact, i.createdAt, i.updatedAt]), [
    ["Elevated API errors", "disrupted", "2026-10-01T09:30:00.000Z", "2026-10-01T09:45:00.000Z"],
  ]);
});

test("down reads a major outage; an unknown word reads the worst", () => {
  const body = (summaryStatus: string) => JSON.stringify({ summaryStatus, systems: [] });
  assert.equal(parseCState(body("down"), service).overallStatus, "major_outage");
  assert.equal(parseCState(body("on-fire"), service).overallStatus, "major_outage");
  assert.equal(parseCState(body("<no value>"), service).overallStatus, "unknown");
});

test("scoping folds the selected systems, named by name", () => {
  const read = parseCState(fixture("disrupted"), { ...service, scopeToComponents: true, components: [{ id: "Website", name: "Website" }] });
  assert.equal(read.overallStatus, "operational");
});

test("the picker lists systems under their category", () => {
  assert.deepEqual(parseCStateComponents(fixture("disrupted"), service).slice(0, 2).map((c) => [c.id, c.group, c.status]), [
    ["Gateway", "North Coast", "degraded"],
    ["Backup Gateway", "North Coast", "operational"],
  ]);
});
