import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSamples } from "../../src/ui/backfill.ts";
import type { HistoricalIncident } from "../../src/core/types.ts";

const incident = (over: Partial<HistoricalIncident> = {}): HistoricalIncident => ({
  id: "h1",
  name: "API errors",
  impact: "major",
  status: "resolved",
  startedAt: "2026-08-01T00:20:00.000Z",
  resolvedAt: "2026-08-01T00:40:00.000Z",
  updatedAt: "2026-08-01T00:40:00.000Z",
  ...over,
});

const FROM = "2026-08-01T00:00:00.000Z";
const TO = "2026-08-01T01:00:00.000Z";

test("no incidents means every slot is operational, on a grid strictly before `to`", () => {
  const samples = deriveSamples([], null, FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => sample.observedAt),
    [
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:15:00.000Z",
      "2026-08-01T00:30:00.000Z",
      "2026-08-01T00:45:00.000Z",
    ],
  );
  assert.ok(samples.every((sample) => sample.overallStatus === "operational" && sample.ok));
});

test("a resolved incident window marks exactly its slots, mapped from impact", () => {
  const samples = deriveSamples([incident()], null, FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => [sample.observedAt.slice(11, 16), sample.overallStatus, sample.ok]),
    [
      ["00:00", "operational", true],
      ["00:15", "operational", true],
      ["00:30", "partial_outage", false], // major → partial_outage
      ["00:45", "operational", true],     // resolvedAt 00:40 is exclusive
    ],
  );
});

test("each impact maps to its status, unknown impact is at least a degradation", () => {
  const expected = {
    minor: "degraded",
    major: "partial_outage",
    critical: "major_outage",
    "": "degraded",
    weird: "degraded",
  } as const;
  for (const [impact, status] of Object.entries(expected)) {
    const samples = deriveSamples(
      [incident({ impact, startedAt: FROM, resolvedAt: TO })],
      null,
      FROM,
      TO,
      30,
    );
    assert.equal(samples[0]?.overallStatus, status, `impact ${impact}`);
  }
});

test("an open incident extends to the end of the window", () => {
  const samples = deriveSamples(
    [incident({ startedAt: "2026-08-01T00:30:00.000Z", resolvedAt: null })],
    null,
    FROM,
    TO,
    15,
  );
  assert.deepEqual(
    samples.map((sample) => sample.ok),
    [true, true, false, false],
  );
});

test("overlapping incidents: the worst impact wins", () => {
  const samples = deriveSamples(
    [
      incident({ id: "a", impact: "minor", startedAt: FROM, resolvedAt: TO }),
      incident({ id: "b", impact: "critical", startedAt: "2026-08-01T00:30:00.000Z", resolvedAt: TO }),
    ],
    null,
    FROM,
    TO,
    30,
  );
  assert.deepEqual(
    samples.map((sample) => sample.overallStatus),
    ["degraded", "major_outage"],
  );
});

test("coverageStart clips the grid: no samples where the feed proves nothing", () => {
  const samples = deriveSamples([], "2026-08-01T00:30:00.000Z", FROM, TO, 15);
  assert.deepEqual(
    samples.map((sample) => sample.observedAt.slice(11, 16)),
    ["00:30", "00:45"],
  );
});

test("an incident that started before the window still marks slots inside it", () => {
  const samples = deriveSamples(
    [incident({ startedAt: "2026-07-20T00:00:00.000Z", resolvedAt: "2026-08-01T00:20:00.000Z" })],
    null,
    FROM,
    TO,
    15,
  );
  assert.deepEqual(
    samples.map((sample) => sample.ok),
    [false, false, true, true],
  );
});

test("an empty or inverted window yields no samples", () => {
  assert.deepEqual(deriveSamples([], null, TO, FROM, 15), []);
  assert.deepEqual(deriveSamples([], null, FROM, FROM, 15), []);
});

test("an incident with unparseable dates is ignored rather than poisoning the grid", () => {
  const samples = deriveSamples([incident({ startedAt: "not a date" })], null, FROM, TO, 30);
  assert.ok(samples.every((sample) => sample.ok));
});
