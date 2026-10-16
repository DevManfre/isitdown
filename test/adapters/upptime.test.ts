import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseUpptimeComponents, parseUpptimeStatus, summaryUrl, upptimeAdapter } from "../../src/adapters/upptime.adapter.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const service: ServiceRef = { id: "upptime", name: "Example", baseUrl: "https://github.com/owner/repo" };
const fixture = readFileSync(new URL("../fixtures/upptime/summary.json", import.meta.url), "utf8");

runAdapterContract("upptime", () => ({
  adapter: upptimeAdapter,
  service: (baseUrl) => ({ ...service, baseUrl, options: { branch: "main" } }),
  ok: { "/main/history/summary.json": fixture },
  degraded: { "/main/history/summary.json": JSON.stringify([{ name: "Website" }]) },
}));

test("some sites down reads partial outage; every site down reads major", () => {
  assert.equal(parseUpptimeStatus(fixture, service).overallStatus, "partial_outage");
  const allDown = JSON.stringify([{ slug: "a", status: "down" }, { slug: "b", status: "down" }]);
  assert.equal(parseUpptimeStatus(allDown, service).overallStatus, "major_outage");
});

test("degraded without a down site reads degraded; all up reads operational", () => {
  assert.equal(parseUpptimeStatus(JSON.stringify([{ slug: "a", status: "up" }, { slug: "b", status: "degraded" }]), service).overallStatus, "degraded");
  assert.equal(parseUpptimeStatus(JSON.stringify([{ slug: "a", status: "up" }]), service).overallStatus, "operational");
});

test("a word Upptime does not use reads as the worst case", () => {
  assert.equal(parseUpptimeStatus(JSON.stringify([{ slug: "a", status: "wobbly" }]), service).overallStatus, "major_outage");
});

test("scoping to a selected site ignores the others", () => {
  const status = parseUpptimeStatus(fixture, { ...service, scopeToComponents: true, components: [{ id: "website", name: "Website" }] });
  assert.equal(status.overallStatus, "operational");
});

test("the picker lists every site with its current state", () => {
  assert.deepEqual(parseUpptimeComponents(fixture, service).map((c) => [c.id, c.status]), [
    ["website", "operational"], ["api", "major_outage"], ["docs", "degraded"],
  ]);
});

test("a github.com repository url resolves to the raw summary; HEAD follows the default branch", () => {
  assert.equal(summaryUrl(service), "https://raw.githubusercontent.com/owner/repo/HEAD/history/summary.json");
  assert.equal(
    summaryUrl({ ...service, baseUrl: "https://github.com/owner/repo.git/", options: { branch: "master" } }),
    "https://raw.githubusercontent.com/owner/repo/master/history/summary.json",
  );
});
