import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  bestFixture,
  driftBetween,
  hasFindings,
  judge,
  loadFixtures,
  renderReport,
  shapeOf,
} from "../../tools/canary.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const entry = { id: "github", adapter: "statuspage" };
const json = (url: string, body: unknown, status = 200) => ({
  url,
  status,
  body: JSON.stringify(body),
  contentType: "application/json",
});

test("a list folds its elements into one shape, and null is recorded as its own kind", () => {
  const shape = shapeOf({ items: [{ id: "a", at: null }, { id: "b", at: "x" }] });
  assert.deepEqual([...(shape.get("$.items[].at") ?? [])].sort(), ["null", "string"]);
  assert.deepEqual([...(shape.get("$.items") ?? [])], ["array"]);
});

const drift: { name: string; fixture: unknown; live: unknown; expected: string[] }[] = [
  { name: "the same shape is no drift", fixture: { a: 1, b: { c: "x" } }, live: { a: 2, b: { c: "y" } }, expected: [] },
  { name: "a field the provider added is no drift", fixture: { a: 1 }, live: { a: 1, extra: true }, expected: [] },
  { name: "a field the provider dropped is drift", fixture: { a: 1, b: "x" }, live: { a: 1 }, expected: ["missing $.b"] },
  { name: "a field that changed kind is drift", fixture: { a: 1 }, live: { a: "1" }, expected: ["changed $.a"] },
  { name: "null on either side is a wildcard", fixture: { a: null, b: 1 }, live: { a: "x", b: null }, expected: [] },
  {
    name: "an empty list today says nothing about its elements",
    fixture: { incidents: [{ id: "a", name: "x" }] },
    live: { incidents: [] },
    expected: [],
  },
  {
    name: "a field gone from every element is drift",
    fixture: { incidents: [{ id: "a", name: "x" }] },
    live: { incidents: [{ id: "a" }] },
    expected: ["missing $.incidents[].name"],
  },
];

for (const { name, fixture, live, expected } of drift) {
  test(name, () => {
    const found = driftBetween(shapeOf(fixture), shapeOf(live)).map((item) => `${item.problem} ${item.path}`);
    assert.deepEqual(found, expected);
  });
}

test("a live answer is compared with the fixture it most resembles, or none under half", () => {
  const summary = { name: "summary.json", shape: shapeOf({ status: { indicator: "none" }, incidents: [] }) };
  const history = { name: "history.json", shape: shapeOf({ page: {}, incidents: [{ id: "a", resolved_at: null }] }) };
  assert.equal(bestFixture(shapeOf({ status: { indicator: "minor" }, incidents: [] }), [history, summary])?.name, "summary.json");
  assert.equal(bestFixture(shapeOf({ something: "else" }), [history, summary]), null);
});

test("the committed Statuspage fixtures load, and the deliberately broken one is left out", () => {
  const names = loadFixtures(root, "statuspage").map((fixture) => fixture.name);
  assert.ok(names.includes("operational.json"));
  assert.ok(!names.includes("malformed.json"));
  assert.deepEqual(loadFixtures(root, "no-such-adapter"), []);
});

const fixtures = [{ name: "operational.json", shape: shapeOf({ status: { indicator: "none" }, incidents: [] }) }];

test("a page that answers an error is unreachable, not broken", () => {
  const result = judge(entry, {
    captured: [json("https://x/api/v2/summary.json", {}, 403)],
    error: new Error("HTTP 403"),
    fixtures,
  });
  assert.equal(result.outcome, "unreachable");
  assert.match(result.detail ?? "", /HTTP 403/);
});

test("a page that never answered is unreachable", () => {
  assert.equal(judge(entry, { captured: [], error: new Error("timeout"), fixtures }).outcome, "unreachable");
});

test("a page that answered but the adapter could not read is broken", () => {
  const result = judge(entry, { captured: [json("https://x", { status: { indicator: "none" }, incidents: [] })], error: new Error("bad"), fixtures });
  assert.equal(result.outcome, "broken");
});

test("a page that parses but lost a field its fixture has is drift, and one that matches is ok", () => {
  const drifted = judge(entry, { captured: [json("https://x", { status: { indicator: "none" } })], fixtures });
  assert.equal(drifted.outcome, "drift");
  assert.equal(drifted.drift?.[0]?.items[0]?.path, "$.incidents");
  assert.equal(judge(entry, { captured: [json("https://x", { status: { indicator: "none" }, incidents: [] })], fixtures }).outcome, "ok");
});

test("only drift and broken pages are findings; the report lists them first and the network's noise apart", () => {
  const results = [
    { id: "a", adapter: "statuspage", outcome: "ok" as const },
    { id: "b", adapter: "statuspage", outcome: "unreachable" as const, detail: "HTTP 403" },
  ];
  assert.equal(hasFindings(results), false);
  const withDrift = [
    ...results,
    {
      id: "c",
      adapter: "statuspage",
      outcome: "drift" as const,
      drift: [{ url: "https://c", fixture: "operational.json", items: [{ path: "$.incidents", problem: "missing" as const, expected: "array" }] }],
    },
  ];
  assert.equal(hasFindings(withDrift), true);
  const report = renderReport(withDrift, "2026-10-08T00:00:00.000Z");
  assert.ok(report.indexOf("## Findings (1)") < report.indexOf("## Did not answer (1)"));
  assert.match(report, /`\$\.incidents` is gone \(was array\)/);
  assert.match(report, /1 page\(s\) read cleanly/);
});
