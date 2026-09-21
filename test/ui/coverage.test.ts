import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentsEndingOn, shiftDay } from "../../src/ui/calendarDays.ts";
import { coverageByDay, coverageOver, gapsBetween, type PollCycle } from "../../src/ui/coverage.ts";

const cycle = (startedAt: string, minutes = 3, seconds = 10): PollCycle => ({
  startedAt,
  finishedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
  intervalMinutes: minutes,
});

/** Cycles every `minutes` from `fromIso` up to but not including `toIso`. */
function ticking(fromIso: string, toIso: string, minutes = 3): PollCycle[] {
  const cycles: PollCycle[] = [];
  for (let at = Date.parse(fromIso); at < Date.parse(toIso); at += minutes * 60_000) {
    cycles.push(cycle(new Date(at).toISOString(), minutes));
  }
  return cycles;
}

const daysEndingOn = (endDay: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => shiftDay(endDay, -(count - 1 - index)));

test("a poller ticking steadily leaves no gaps", () => {
  const cycles = ticking("2026-08-19T00:00:00.000Z", "2026-08-20T00:00:00.000Z");
  assert.deepEqual(gapsBetween(cycles, new Date("2026-08-20T00:00:00.000Z")), []);
});

test("a silence longer than twice the cadence is a gap, a slow cycle is not", () => {
  const now = new Date("2026-08-19T02:00:00.000Z");
  // 3-minute cadence: 5 minutes late is within grace, 20 minutes is not.
  const tolerated = [cycle("2026-08-19T00:00:00.000Z"), cycle("2026-08-19T00:05:00.000Z")];
  assert.deepEqual(gapsBetween(tolerated, new Date("2026-08-19T00:06:00.000Z")), []);

  const missed = [cycle("2026-08-19T00:00:00.000Z"), cycle("2026-08-19T00:20:00.000Z")];
  const gaps = gapsBetween(missed, now);
  assert.equal(gaps.length, 2, "the missed beat, and the silence since the last cycle");
  assert.equal(new Date(gaps[0]!.from).toISOString(), "2026-08-19T00:00:10.000Z");
  assert.equal(new Date(gaps[0]!.to).toISOString(), "2026-08-19T00:20:00.000Z");
});

test("a day the poller never missed is fully covered, and one it half missed is half", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  const cycles = [
    ...ticking("2026-08-19T00:00:00.000Z", "2026-08-19T12:00:00.000Z"),
    // Twelve hours of nothing, then it comes back for the rest of the day.
    ...ticking("2026-08-20T00:00:00.000Z", "2026-08-20T00:00:01.000Z"),
  ];
  const daily = coverageByDay(cycles, segmentsEndingOn("2026-08-19", 1, "UTC"), ["2026-08-19"], now);
  assert.equal(daily.length, 1);
  // Covered until just after noon, then nothing: half the day, near enough that
  // the assertion is about the half rather than about the seconds a cycle took.
  assert.ok(daily[0]!.observed !== null && Math.abs(daily[0]!.observed - 0.5) < 0.01, String(daily[0]?.observed));
});

test("days before the first recorded cycle say nothing rather than zero", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const cycles = ticking("2026-08-20T00:00:00.000Z", "2026-08-20T12:00:00.000Z");
  const days = daysEndingOn("2026-08-20", 3);
  const daily = coverageByDay(cycles, segmentsEndingOn("2026-08-20", 3, "UTC"), days, now);
  assert.deepEqual(
    daily.map((entry) => [entry.day, entry.observed]),
    [
      ["2026-08-18", null],
      ["2026-08-19", null],
      ["2026-08-20", 1],
    ],
  );
  // An upgraded install must not have its whole past redrawn as an outage of
  // ours the moment this trace starts existing.
  assert.equal(coverageOver(daily), 1);
});

test("coverage is measured over the operator's day, not UTC's", () => {
  const now = new Date("2026-01-20T12:00:00.000Z");
  // The poller starts at 11:00 UTC on the 19th, which is midnight on the 20th
  // in Auckland: the Auckland 20th is fully covered, the UTC 19th only partly.
  const cycles = ticking("2026-01-19T11:00:00.000Z", "2026-01-20T12:00:00.000Z");
  const auckland = coverageByDay(
    cycles,
    segmentsEndingOn("2026-01-20", 2, "Pacific/Auckland"),
    daysEndingOn("2026-01-20", 2),
    now,
  );
  assert.equal(auckland.at(-1)?.day, "2026-01-20");
  assert.equal(auckland.at(-1)?.observed, 1);
});

test("coverage over a window averages only the days that have an answer", () => {
  assert.equal(coverageOver([{ day: "a", observed: null }]), null);
  assert.equal(
    coverageOver([
      { day: "a", observed: null },
      { day: "b", observed: 1 },
      { day: "c", observed: 0.5 },
    ]),
    0.75,
  );
});
