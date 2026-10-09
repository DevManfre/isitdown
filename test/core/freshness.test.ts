import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceFreshness, fingerprintOf, staleReading } from "../../src/core/freshness.ts";
import type { ComponentStatus, Freshness, NormalizedStatus, OverallStatus } from "../../src/core/types.ts";

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const at = (days: number): string => new Date(T0 + days * DAY).toISOString();

const component = (id: string): ComponentStatus => ({ id, name: id, status: "operational" });

const reading = (
  days: number,
  overallStatus: OverallStatus = "operational",
  components: ComponentStatus[] = [],
): NormalizedStatus => ({
  provider: "github",
  overallStatus,
  activeIncidents: [],
  components,
  maintenances: [],
  fetchedAt: at(days),
});

/** Folds a series of readings, each read the day after the one before unless said otherwise. */
function fold(readings: NormalizedStatus[]): Freshness {
  let freshness: Freshness | null = null;
  let previous: string | null = null;
  for (const status of readings) {
    freshness = advanceFreshness(freshness, status, previous);
    previous = status.fetchedAt;
  }
  assert.ok(freshness !== null);
  return freshness;
}

/** Daily reads from `from` to `to` inclusive, all saying the same thing. */
const daily = (from: number, to: number, status: OverallStatus = "operational"): NormalizedStatus[] =>
  Array.from({ length: to - from + 1 }, (_, index) => reading(from + index, status));

test("the poll time is not part of what a reading says", () => {
  assert.equal(fingerprintOf(reading(0)), fingerprintOf(reading(5)));
  assert.notEqual(fingerprintOf(reading(0)), fingerprintOf(reading(0, "degraded")));
});

test("an unchanged reading hands back the same freshness, so nothing needs writing", () => {
  const first = advanceFreshness(null, reading(0), null);
  assert.equal(advanceFreshness(first, reading(0.01), at(0)), first);
});

test("a change is counted and the stillness before it measured", () => {
  const freshness = fold([reading(0), reading(1), reading(4, "degraded")]);
  assert.equal(freshness.changes, 1);
  assert.equal(freshness.since, at(4));
  assert.equal(freshness.longestStillMs, 4 * DAY);
});

// The table the rest of the file is about: when an unchanged page is suspicious.
const cases: { name: string; readings: NormalizedStatus[]; judgedAt: number; stale: boolean }[] = [
  {
    name: "a page that has never changed is never suspected — there is no record to hold it to",
    readings: daily(0, 60),
    judgedAt: 60,
    stale: false,
  },
  {
    name: "a lively page quiet for less than a week is not suspected",
    readings: [reading(0), reading(1, "degraded"), reading(2), reading(3, "degraded"), ...daily(4, 9, "degraded")],
    judgedAt: 9,
    stale: false,
  },
  {
    name: "a page that moved daily and has held still for a week is suspected",
    readings: [reading(0), reading(1, "degraded"), reading(2), reading(3, "degraded"), ...daily(4, 11, "degraded")],
    judgedAt: 11,
    stale: true,
  },
  {
    name: "a page whose quiet spells run to a month is held to three of them, not to a week",
    readings: [reading(0), reading(30, "degraded"), reading(31), reading(32, "degraded"), ...daily(33, 80, "degraded")],
    judgedAt: 80,
    stale: false,
  },
  {
    name: "the same page is suspected past three of its longest quiet spells",
    readings: [reading(0), reading(30, "degraded"), reading(31), reading(32, "degraded"), ...daily(33, 123, "degraded")],
    judgedAt: 123,
    stale: true,
  },
  {
    name: "days nobody was watching do not count as days the page held still",
    readings: [reading(0), reading(1, "degraded"), reading(2), reading(3, "degraded"), reading(20, "degraded")],
    judgedAt: 20,
    stale: false,
  },
];

for (const { name, readings, judgedAt, stale } of cases) {
  test(name, () => {
    const verdict = staleReading(fold(readings), at(judgedAt));
    assert.equal(verdict?.reason === "unchanged", stale);
  });
}

test("an unchanged verdict says since when and how long the page used to hold still", () => {
  const freshness = fold([reading(0), reading(1, "degraded"), reading(2), reading(3, "degraded"), ...daily(4, 11, "degraded")]);
  assert.deepEqual(staleReading(freshness, at(11)), { reason: "unchanged", since: at(3), longestStillMs: DAY });
});

test("no freshness is no verdict", () => {
  assert.equal(staleReading(null, at(0)), null);
});

test("a reading that lost half its components is suspected as shrunk", () => {
  const full = ["a", "b", "c", "d", "e", "f"].map(component);
  const freshness = fold([reading(0, "operational", full), reading(1, "operational", full.slice(0, 2))]);
  assert.deepEqual(staleReading(freshness, at(1)), { reason: "shrunk", since: at(1), components: 2, expected: 6 });
});

test("losing fewer than half is a provider retiring a component, not a parser losing its way", () => {
  const full = ["a", "b", "c", "d"].map(component);
  const freshness = fold([reading(0, "operational", full), reading(1, "operational", full.slice(0, 2))]);
  assert.equal(staleReading(freshness, at(1)), null);
});

test("components coming back clear the shrunk verdict", () => {
  const full = ["a", "b", "c", "d"].map(component);
  const freshness = fold([
    reading(0, "operational", full),
    reading(1, "operational", full.slice(0, 1)),
    reading(2, "operational", full),
  ]);
  assert.equal(staleReading(freshness, at(2)), null);
});

test("a smaller shape that lasts a month is taken as the new normal", () => {
  const full = ["a", "b", "c", "d"].map(component);
  const freshness = fold([
    reading(0, "operational", full),
    reading(1, "operational", full.slice(0, 1)),
    reading(31, "operational", full.slice(0, 1)),
  ]);
  assert.equal(staleReading(freshness, at(31)), null);
  assert.equal(freshness.peakComponents, 1);
});
