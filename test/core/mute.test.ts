import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveMutedUntil, scheduleRunsUntil } from "../../src/core/mute.ts";
import type { MuteSchedule } from "../../src/core/configSource.interface.ts";

// Roadmap 5.2. 2026-11-03 is a Tuesday.
const TUESDAY_0230_UTC = new Date("2026-11-03T02:30:00.000Z");

const weekly = (over: Partial<Extract<MuteSchedule, { days: unknown }>> = {}): MuteSchedule => ({
  days: ["tue"],
  start: "02:00",
  end: "04:00",
  timeZone: "UTC",
  ...over,
});

const cases: { name: string; schedule: MuteSchedule; at: Date; until: string | null }[] = [
  {
    name: "a weekly window running now ends at its own end",
    schedule: weekly(),
    at: TUESDAY_0230_UTC,
    until: "2026-11-03T04:00:00.000Z",
  },
  { name: "the same window on another weekday is not running", schedule: weekly({ days: ["wed"] }), at: TUESDAY_0230_UTC, until: null },
  { name: "the end is exclusive", schedule: weekly(), at: new Date("2026-11-03T04:00:00.000Z"), until: null },
  {
    name: "the window is read in its own zone, not UTC",
    // 02:30 UTC is 03:30 in Rome in November, inside 03:00–05:00 Rome.
    schedule: weekly({ start: "03:00", end: "05:00", timeZone: "Europe/Rome" }),
    at: TUESDAY_0230_UTC,
    until: "2026-11-03T04:00:00.000Z",
  },
  {
    name: "a window wrapping midnight runs into the next morning",
    schedule: weekly({ days: ["mon"], start: "23:00", end: "03:00" }),
    at: TUESDAY_0230_UTC,
    until: "2026-11-03T03:00:00.000Z",
  },
  {
    name: "and its morning half belongs to the day before only",
    schedule: weekly({ days: ["tue"], start: "23:00", end: "03:00" }),
    at: TUESDAY_0230_UTC,
    until: null,
  },
  {
    name: "a wrapping window's evening half ends tomorrow",
    schedule: weekly({ days: ["tue"], start: "23:00", end: "03:00" }),
    at: new Date("2026-11-03T23:30:00.000Z"),
    until: "2026-11-04T03:00:00.000Z",
  },
  {
    name: "an unknown zone mutes nothing",
    schedule: weekly({ timeZone: "Mars/Olympus" }),
    at: TUESDAY_0230_UTC,
    until: null,
  },
  {
    name: "a single span running now ends at its until",
    schedule: { from: "2026-11-01T00:00:00.000Z", until: "2026-11-05T00:00:00.000Z" },
    at: TUESDAY_0230_UTC,
    until: "2026-11-05T00:00:00.000Z",
  },
  {
    name: "a future span is not running yet",
    schedule: { from: "2026-11-06T17:00:00.000Z", until: "2026-11-09T07:00:00.000Z" },
    at: TUESDAY_0230_UTC,
    until: null,
  },
];

for (const { name, schedule, at, until } of cases) {
  test(`mute schedule: ${name}`, () => {
    assert.equal(scheduleRunsUntil(schedule, at)?.toISOString() ?? null, until);
  });
}

test("the pressed mute and every planned one fold into the latest end", () => {
  const at = TUESDAY_0230_UTC.toISOString();
  assert.equal(effectiveMutedUntil({}, at), null);
  assert.equal(
    effectiveMutedUntil({ mutedUntil: "2026-11-03T03:00:00.000Z", muteSchedules: [weekly()] }, at),
    "2026-11-03T04:00:00.000Z",
  );
  assert.equal(
    effectiveMutedUntil({ mutedUntil: "2026-11-03T06:00:00.000Z", muteSchedules: [weekly()] }, at),
    "2026-11-03T06:00:00.000Z",
  );
  // A spent pressed mute is no mute, schedule or not.
  assert.equal(effectiveMutedUntil({ mutedUntil: "2026-11-03T01:00:00.000Z" }, at), null);
});
