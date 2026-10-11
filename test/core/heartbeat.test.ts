import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heartbeatConfig,
  heartbeatProblems,
  heartbeatVerdict,
  parseDurationSeconds,
} from "../../src/core/heartbeat.ts";

/**
 * Roadmap 2.5, the dead-man's switch: the verdict is the whole feature, so it
 * is held here as a table — when a job is on time, when it is late, and that a
 * job which never calls is late too rather than pending forever.
 */

test("durations take one number and one unit", () => {
  for (const [input, seconds] of [
    ["90s", 90],
    ["30m", 1800],
    ["24h", 86_400],
    ["7d", 604_800],
    [" 2H ", 7200],
  ] as const) {
    assert.equal(parseDurationSeconds(input), seconds, input);
  }
  for (const input of ["24", "", "1.5h", "0m", "-5m", "1w", "h"]) {
    assert.equal(parseDurationSeconds(input), null, input);
  }
});

test("grace defaults to a tenth of the period, never under a minute", () => {
  assert.deepEqual(heartbeatConfig({ every: "24h" }), { everySeconds: 86_400, graceSeconds: 8640 });
  assert.deepEqual(heartbeatConfig({ every: "5m" }), { everySeconds: 300, graceSeconds: 60 });
  assert.deepEqual(heartbeatConfig({ every: "1h", grace: "15m" }), { everySeconds: 3600, graceSeconds: 900 });
});

test("options that cannot work are named, one sentence each", () => {
  const cases: [Record<string, string> | undefined, RegExp][] = [
    [undefined, /needs every/],
    [{ every: "24" }, /not a duration/],
    [{ every: "30s" }, /at least 1m/],
    [{ every: "40d" }, /at most 35d/],
    [{ every: "1h", grace: "soon" }, /grace "soon"/],
    [{ every: "1h", grace: "2h" }, /longer than every/],
  ];
  for (const [options, message] of cases) {
    const problems = heartbeatProblems(options);
    assert.equal(problems.length, 1, JSON.stringify(options));
    assert.match(problems[0]!, message);
  }
  assert.deepEqual(heartbeatProblems({ every: "1d", grace: "1h" }), []);
});

test("the verdict turns at the period plus its grace", () => {
  const config = { everySeconds: 3600, graceSeconds: 600 };
  const lastPingAt = "2026-10-11T10:00:00.000Z";
  const at = (iso: string) => heartbeatVerdict(config, { armedAt: "2026-10-01T00:00:00.000Z", lastPingAt }, new Date(iso));

  const cases: [string, "operational" | "major_outage"][] = [
    ["2026-10-11T10:30:00.000Z", "operational"], // inside the period
    ["2026-10-11T11:05:00.000Z", "operational"], // past the period, inside the grace
    ["2026-10-11T11:10:00.000Z", "operational"], // exactly at the deadline
    ["2026-10-11T11:10:01.000Z", "major_outage"], // one second past it
    ["2026-10-14T00:00:00.000Z", "major_outage"], // three weeks of silence reads the same
  ];
  for (const [now, status] of cases) assert.equal(at(now).status, status, now);
  assert.equal(at("2026-10-11T10:30:00.000Z").deadline, "2026-10-11T11:10:00.000Z");
});

test("a job that never called is measured from when the monitor was armed", () => {
  const config = { everySeconds: 3600, graceSeconds: 600 };
  const times = { armedAt: "2026-10-11T10:00:00.000Z", lastPingAt: null };
  assert.equal(heartbeatVerdict(config, times, new Date("2026-10-11T10:59:00.000Z")).status, "operational");
  assert.equal(heartbeatVerdict(config, times, new Date("2026-10-11T12:00:00.000Z")).status, "major_outage");
});
