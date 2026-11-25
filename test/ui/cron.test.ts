import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCronRun, parseCron } from "../../src/ui/cron.ts";

/** Roadmap 10.1: the schedule a backup runs on, as a table. */

const at = (iso: string): number => Date.parse(iso);
const next = (expression: string, after: string, zone = "UTC"): string | null => {
  const run = nextCronRun(parseCron(expression), at(after), zone);
  return run === null ? null : new Date(run).toISOString();
};

const CASES: [string, string, string, string | null][] = [
  // expression, after, zone, expected
  ["0 3 * * *", "2026-11-24T02:59:30Z", "UTC", "2026-11-24T03:00:00.000Z"],
  ["0 3 * * *", "2026-11-24T03:00:00Z", "UTC", "2026-11-25T03:00:00.000Z"],
  ["*/15 * * * *", "2026-11-24T10:07:00Z", "UTC", "2026-11-24T10:15:00.000Z"],
  ["30 2 * * 0", "2026-11-24T00:00:00Z", "UTC", "2026-11-29T02:30:00.000Z"],
  ["30 2 * * 7", "2026-11-24T00:00:00Z", "UTC", "2026-11-29T02:30:00.000Z"],
  ["0 0 1 * *", "2026-11-24T00:00:00Z", "UTC", "2026-12-01T00:00:00.000Z"],
  ["0 4 1-7 * 1", "2026-11-24T00:00:00Z", "UTC", "2026-11-30T04:00:00.000Z"],
  ["0 9,17 * * 1-5", "2026-11-28T00:00:00Z", "UTC", "2026-11-30T09:00:00.000Z"],
  ["0 3 * * *", "2026-11-24T00:00:00Z", "Europe/Rome", "2026-11-24T02:00:00.000Z"],
  ["0 0 31 2 *", "2026-11-24T00:00:00Z", "UTC", null],
];

for (const [expression, after, zone, expected] of CASES) {
  test(`"${expression}" after ${after} in ${zone} runs at ${expected}`, () => {
    assert.equal(next(expression, after, zone), expected);
  });
}

test("a schedule across the spring-forward hour still finds its next run", () => {
  // 02:30 does not exist in Rome on 2027-03-28; the next 02:30 is the day after.
  assert.equal(next("30 2 * * *", "2027-03-27T02:00:00Z", "Europe/Rome"), "2027-03-29T00:30:00.000Z");
});

test("an expression that is not one says which field is wrong", () => {
  assert.throws(() => parseCron("0 3 * *"), /five fields/);
  assert.throws(() => parseCron("61 3 * * *"), /minute/);
  assert.throws(() => parseCron("0 3 * * MON"), /day of week/);
  assert.throws(() => parseCron("*/0 * * * *"), /step/);
});
