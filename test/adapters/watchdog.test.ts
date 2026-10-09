import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeText, parseWatchedPage, watchdogAdapter } from "../../src/adapters/watchdog.adapter.ts";
import { optionProblems } from "../../src/adapters/index.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/watchdog/${name}.html`, import.meta.url), "utf8");

const service = (options: Record<string, string> = { selector: ".notice", baseline: "All systems normal." }): ServiceRef => ({
  id: "example",
  name: "Example",
  baseUrl: "https://status.example.com/",
  options,
});

runAdapterContract("watchdog", () => ({
  adapter: watchdogAdapter,
  service: (baseUrl) => ({ ...service(), baseUrl: `${baseUrl}/status` }),
  ok: { "/status": fixture("normal") },
  degraded: { "/status": '<p class="notice">All systems normal.</p>' },
}));

test("a page still reading its baseline is operational, with nothing open", () => {
  const status = parseWatchedPage(fixture("normal"), service());
  assert.equal(status.provider, "example");
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
  assert.deepEqual(status.components, []);
  assert.deepEqual(status.maintenances, []);
});

test("a page whose text moved off its baseline is degraded, and the new text is the incident", () => {
  const status = parseWatchedPage(fixture("changed"), service());
  assert.equal(status.overallStatus, "degraded");
  assert.equal(status.activeIncidents.length, 1);
  const [incident] = status.activeIncidents;
  assert.equal(incident?.name, "We are investigating reports of failed logins for some customers.");
  assert.equal(incident?.status, "changed");
  assert.equal(incident?.impact, "", "the adapter does not guess what the change means");
  assert.equal(incident?.createdAt, undefined, "the page states no time of its own");
});

test("the same new text is the same incident on every read, and different text is another one", () => {
  const first = parseWatchedPage(fixture("changed"), service());
  const again = parseWatchedPage(fixture("changed"), service());
  const other = parseWatchedPage('<p class="notice">Logins are fixed; email is delayed.</p>', service());
  assert.equal(first.activeIncidents[0]?.id, again.activeIncidents[0]?.id);
  assert.notEqual(first.activeIncidents[0]?.id, other.activeIncidents[0]?.id);
});

test("re-wrapping a line or changing its capitals is not a change", () => {
  const status = parseWatchedPage('<p class="notice">  ALL   systems\n normal. </p>', service());
  assert.equal(status.overallStatus, "operational");
  assert.equal(normalizeText(" A\n\tb  C "), "a b c");
});

test("with no selector the whole page is watched, script and style bodies left out", () => {
  const baseline = "Example status Example service status All systems normal.";
  assert.equal(parseWatchedPage(fixture("normal"), service({ baseline })).overallStatus, "operational");
  assert.equal(parseWatchedPage(fixture("changed"), service({ baseline })).overallStatus, "degraded");
});

test("a very long new text is cut to a title a phone can show", () => {
  const status = parseWatchedPage(`<p class="notice">${"word ".repeat(200)}</p>`, service());
  const name = status.activeIncidents[0]?.name ?? "";
  assert.equal(name.length, 280);
  assert.ok(name.endsWith("…"));
});

test("a selector that matches nothing throws rather than reading a change", () => {
  assert.throws(
    () => parseWatchedPage(fixture("normal"), service({ selector: ".gone", baseline: "x" })),
    /selector \.gone matched nothing/,
  );
});

test("no baseline throws, saying what the page reads now", () => {
  assert.throws(
    () => parseWatchedPage(fixture("normal"), service({ selector: ".notice" })),
    /no "baseline" option — the page currently reads: "All systems normal\."/,
  );
});

test("saving a watchdog without a baseline is refused", () => {
  assert.equal(optionProblems("watchdog", { selector: ".notice" }).length, 1);
  assert.equal(optionProblems("watchdog", { baseline: "   " }).length, 1);
  assert.deepEqual(optionProblems("watchdog", { baseline: "All systems normal." }), []);
});
