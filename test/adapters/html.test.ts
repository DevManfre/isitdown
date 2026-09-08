import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { htmlAdapter, parsePageStatus, severityFromPage } from "../../src/adapters/html.adapter.ts";
import { parseSelector, select, selectText, textOf } from "../../src/adapters/htmlSelect.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/html/${name}.html`, import.meta.url), "utf8");

const service = (options: Record<string, string> = { selector: ".status-banner" }): ServiceRef => ({
  id: "example",
  name: "Example",
  baseUrl: "https://status.example.com/",
  options,
});

runAdapterContract("html", () => ({
  adapter: htmlAdapter,
  service: (baseUrl) => ({ ...service(), baseUrl: `${baseUrl}/status` }),
  ok: { "/status": fixture("operational") },
  // A page stripped to the one element the selector names: everything else a
  // page carries is decoration this adapter never reads.
  degraded: { "/status": '<html><body><div class="status-banner">Operational</div></body></html>' },
}));

test("a page saying everything is fine reads operational, with no incidents to report", () => {
  const status = parsePageStatus(fixture("operational"), service());

  assert.equal(status.provider, "example");
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
  assert.deepEqual(status.components, []);
  assert.deepEqual(status.maintenances, []);
});

test("a page mixing an outage with an all-clear reads as the outage", () => {
  assert.equal(parsePageStatus(fixture("incident"), service()).overallStatus, "partial_outage");
});

test("text matching no configured word reads unknown rather than operational", () => {
  assert.equal(parsePageStatus(fixture("unusual"), service()).overallStatus, "unknown");
});

test("the operator's own words for one severity replace the defaults for it alone", () => {
  const options = { selector: ".status-banner", operational: "tutto tranquillo, nessun problema" };

  assert.equal(parsePageStatus(fixture("unusual"), service(options)).overallStatus, "operational");
  // The severities left alone keep reading with the default words.
  assert.equal(parsePageStatus(fixture("incident"), service(options)).overallStatus, "partial_outage");
});

test("a selector that matches nothing throws, so a page that moved cannot read as a status", () => {
  assert.throws(() => parsePageStatus(fixture("moved"), service()), /matched nothing/);
});

test("a service with no selector configured throws rather than guessing one", () => {
  assert.throws(() => parsePageStatus(fixture("operational"), service({})), /no "selector" option/);
  assert.throws(() => parsePageStatus(fixture("operational"), service({ selector: "  " })), /no "selector" option/);
});

test("a status word inside a longer word is not a reading", () => {
  // "up" is a default word for operational; "backup" is not the provider
  // saying it is up.
  assert.equal(severityFromPage("Scheduled backup running"), "unknown");
  assert.equal(severityFromPage("Everything is up"), "operational");
});

test("markup inside a script tag is text, not a matchable element", () => {
  // The fixture's <script> writes a `.status-banner` div saying "Major outage".
  assert.equal(parsePageStatus(fixture("operational"), service()).overallStatus, "operational");
});

test("entities and collapsed whitespace read as the words a browser would show", () => {
  assert.equal(selectText(fixture("operational"), "div.status-banner"), "All systems operational");
  assert.equal(selectText(fixture("incident"), ".status-banner"), "Partial outage on the API — everything else operational");
});

test("descendant and child combinators pick the element they name", () => {
  const html = '<div id="a"><section><p class="x">deep</p></section><p class="x">shallow</p></div>';

  assert.equal(selectText(html, "#a p.x"), "deep");
  assert.equal(selectText(html, "#a > p.x"), "shallow");
  assert.equal(selectText(html, "#a > section > p"), "deep");
});

test("an attribute selector matches on presence and on an exact value", () => {
  const html = '<span data-status="up">fine</span><span data-status="down">bad</span>';

  assert.equal(selectText(html, "span[data-status]"), "fine");
  assert.equal(selectText(html, 'span[data-status="down"]'), "bad");
});

test("a selector this reader cannot honour throws instead of matching nothing", () => {
  assert.throws(() => parseSelector(""), /empty/);
  assert.throws(() => parseSelector(".a, .b"), /selector list/);
  assert.throws(() => parseSelector("p:first-child"), /unsupported selector/);
  assert.throws(() => parseSelector("li ~ p"), /unsupported selector/);
  assert.throws(() => parseSelector("div >"), /unsupported selector/);
  assert.throws(() => parseSelector('a[href^="/x"]'), /unsupported attribute operator/);
});

test("an unclosed element still parses, and its text stays under it", () => {
  const element = select("<main><div class=s>open<p>inner</main>", ".s");

  assert.notEqual(element, null);
  assert.equal(textOf(element!), "open inner");
});
