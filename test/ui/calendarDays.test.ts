import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayStart,
  daysBetween,
  offsetSegments,
  resolveZone,
  segmentsEndingOn,
  shiftDay,
  zonedDayKey,
} from "../../src/ui/calendarDays.ts";

test("a day key is the operator's day, not UTC's", () => {
  // 20:00 in Auckland on the 19th is 07:00 UTC on the 19th in winter, but the
  // evening of a summer day there is already tomorrow in UTC.
  const evening = new Date("2026-01-19T09:00:00.000Z");
  assert.equal(zonedDayKey(evening, "UTC"), "2026-01-19");
  assert.equal(zonedDayKey(evening, "Pacific/Auckland"), "2026-01-19");
  const lateEvening = new Date("2026-01-19T12:00:00.000Z");
  assert.equal(zonedDayKey(lateEvening, "UTC"), "2026-01-19");
  assert.equal(zonedDayKey(lateEvening, "Pacific/Auckland"), "2026-01-20");
  // And the other way: early morning UTC is still yesterday in Los Angeles.
  assert.equal(zonedDayKey(new Date("2026-01-19T03:00:00.000Z"), "America/Los_Angeles"), "2026-01-18");
});

test("day arithmetic crosses a spring forward without losing a day", () => {
  // Italy moves to summer time on 2026-03-29, a 23-hour day.
  assert.equal(shiftDay("2026-03-28", 1), "2026-03-29");
  assert.equal(shiftDay("2026-03-29", 1), "2026-03-30");
  assert.equal(shiftDay("2026-03-30", -2), "2026-03-28");
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
});

test("a day starts at the operator's midnight, and a short day is short", () => {
  const short = dayStart("2026-03-29", "Europe/Rome");
  const after = dayStart("2026-03-30", "Europe/Rome");
  assert.equal(short.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(after.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(after.getTime() - short.getTime(), 23 * 3600 * 1000);

  // And the autumn day is the 25-hour one.
  const long = dayStart("2026-10-25", "Europe/Rome");
  const next = dayStart("2026-10-26", "Europe/Rome");
  assert.equal(next.getTime() - long.getTime(), 25 * 3600 * 1000);
});

test("a window with no transition is one segment", () => {
  const segments = offsetSegments("2026-06-01", "2026-06-07", "Europe/Rome");
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], {
    fromIso: "2026-05-31T22:00:00.000Z",
    toIso: "2026-06-07T22:00:00.000Z",
    offsetMinutes: 120,
  });
});

test("a window spanning a transition is cut at the transition instant", () => {
  const segments = offsetSegments("2026-03-27", "2026-03-31", "Europe/Rome");
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.offsetMinutes, 60);
  assert.equal(segments[1]?.offsetMinutes, 120);
  // Italy shifts at 01:00 UTC on the last Sunday of March.
  assert.equal(segments[0]?.toIso, "2026-03-29T01:00:00.000Z");
  assert.equal(segments[1]?.fromIso, "2026-03-29T01:00:00.000Z");
  // The seam is exactly a seam: no instant in the window belongs to neither
  // segment or to both.
  assert.equal(segments[0]?.fromIso, dayStart("2026-03-27", "Europe/Rome").toISOString());
  assert.equal(segments[1]?.toIso, dayStart("2026-04-01", "Europe/Rome").toISOString());
});

test("applying a segment's offset puts every instant on its own local day", () => {
  // The property the SQL aggregation relies on: within a segment, adding the
  // segment's offset to an instant and reading the date gives the same day
  // `zonedDayKey` would.
  for (const zone of ["Europe/Rome", "Pacific/Auckland", "America/Los_Angeles", "Asia/Kolkata"]) {
    for (const segment of offsetSegments("2026-03-25", "2026-11-05", zone)) {
      for (const at of [segment.fromIso, segment.toIso]) {
        const instant = new Date(at === segment.toIso ? Date.parse(at) - 1 : Date.parse(at));
        const shifted = new Date(instant.getTime() + segment.offsetMinutes * 60_000);
        assert.equal(
          shifted.toISOString().slice(0, 10),
          zonedDayKey(instant, zone),
          `${zone} ${instant.toISOString()}`,
        );
      }
    }
  }
});

test("segmentsEndingOn covers exactly the days asked for", () => {
  const segments = segmentsEndingOn("2026-06-07", 7, "Europe/Rome");
  assert.equal(segments[0]?.fromIso, dayStart("2026-06-01", "Europe/Rome").toISOString());
  assert.equal(segments.at(-1)?.toIso, dayStart("2026-06-08", "Europe/Rome").toISOString());
});

test("an unusable zone name falls back to UTC rather than throwing", () => {
  assert.equal(resolveZone("Mars/Olympus"), "UTC");
  assert.equal(resolveZone("Europe/Rome"), "Europe/Rome");
  assert.equal(resolveZone("auto"), Intl.DateTimeFormat().resolvedOptions().timeZone);
});
