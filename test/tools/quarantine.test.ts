import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { excludeArgs, parseQuarantine, partition, quarantinedCommand, withExclusion } from "../../tools/quarantine.mjs";

const entry = (over: Record<string, string> = {}) => ({
  suite: "server",
  name: "poller retries (sometimes)",
  owner: "someone",
  reason: "times out on a loaded runner",
  issue: "https://linear.app/example/issue/ALE-1",
  expires: "2026-12-01",
  ...over,
});

test("the shipped quarantine file is valid", () => {
  parseQuarantine(readFileSync(new URL("../quarantine.json", import.meta.url), "utf8"));
});

test("an entry without an owner, a reason, an issue link or a real date is refused", () => {
  for (const broken of [{ owner: "" }, { reason: "" }, { issue: "ALE-1" }, { expires: "next week" }, { suite: "e2e" }]) {
    assert.throws(() => parseQuarantine(JSON.stringify({ tests: [entry(broken)] })), undefined, JSON.stringify(broken));
  }
});

test("an entry is live through its expiry day and expired the day after", () => {
  const entries = [entry()];
  assert.equal(partition(entries, "2026-12-01").live.length, 1);
  assert.equal(partition(entries, "2026-12-02").expired.length, 1);
});

test("the blocking run skips a quarantined test by its full name, regex characters and all", () => {
  assert.deepEqual(excludeArgs("server", [entry()]), ["--test-skip-pattern=^(?:poller retries \\(sometimes\\))$"]);
  assert.deepEqual(excludeArgs("dashboard", [entry({ suite: "dashboard" })]), ["-t", "^(?!(?:poller retries \\(sometimes\\))$)"]);
  assert.deepEqual(excludeArgs("server", []), []);
});

test("the exclusion goes where each runner reads it: before node's files, after Vitest's subcommand", () => {
  assert.equal(withExclusion("server", ["--test", "a.test.ts"], [entry()])[0]?.startsWith("--test-skip-pattern="), true);
  assert.deepEqual(withExclusion("dashboard", ["run", "--coverage"], [entry({ suite: "dashboard" })]).slice(0, 2), ["run", "--coverage"]);
});

test("the non-blocking run asks for exactly the quarantined tests", () => {
  const [program, args] = quarantinedCommand("dashboard", [entry({ suite: "dashboard" })]);
  assert.equal(program, "vitest");
  assert.deepEqual(args, ["run", "-t", "^(?:poller retries \\(sometimes\\))$"]);
});

test("check passes on the shipped file, which has nothing expired", () => {
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const run = spawnSync(process.execPath, [new URL("../../tools/quarantine.mjs", import.meta.url).pathname, "check"], { encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
});
