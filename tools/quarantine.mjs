#!/usr/bin/env node
// Quarantine for unstable tests (roadmap 13.6). `test/quarantine.json` lists
// the tests that fail some of the time, each with an owner, a reason, the
// issue tracking the fix and an expiry date:
//
//   { "suite": "server" | "dashboard",
//     "name": "<describe names and the test name, joined by spaces>",
//     "owner": "…", "reason": "…", "issue": "https://…", "expires": "YYYY-MM-DD" }
//
// While an entry is live its test still runs, but apart: the blocking run
// skips it, and a second run executes it and reports the result without
// failing anything. The day it expires it is blocking again, and `check`
// fails CI until the test is fixed and the entry removed — or the entry is
// renewed with a reason in the diff. There is deliberately no retry anywhere:
// a retry hides a flaky test, quarantine names it.
//
// CLI:
//   node tools/quarantine.mjs check                       fails on an expired or malformed entry
//   node tools/quarantine.mjs run <suite> -- <command…>   the suite's command, quarantine applied
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { z } from "zod";

const FILE = new URL("../test/quarantine.json", import.meta.url);

const entrySchema = z.object({
  suite: z.enum(["server", "dashboard"]),
  name: z.string().min(1),
  owner: z.string().min(1),
  reason: z.string().min(1),
  issue: z.string().url(),
  expires: z.string().date(),
});
const fileSchema = z.object({ $comment: z.string().optional(), tests: z.array(entrySchema) });

/** The entries, validated: a malformed file is an error, never an empty list. */
export function parseQuarantine(text) {
  return fileSchema.parse(JSON.parse(text)).tests;
}

/** Live entries and expired ones, as of `today` (YYYY-MM-DD, UTC). An entry is live through its expiry day. */
export function partition(entries, today) {
  return {
    live: entries.filter((entry) => entry.expires >= today),
    expired: entries.filter((entry) => entry.expires < today),
  };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (entries) => `(?:${entries.map((entry) => escape(entry.name)).join("|")})`;

/**
 * The arguments that keep `entries` out of a suite's blocking run. node:test
 * and Vitest both match a pattern against the full name — describe names and
 * the test's own, joined by spaces — so one name serves both; Vitest has no
 * skip pattern, so its exclusion is a negative look-ahead on the name filter.
 */
export function excludeArgs(suite, entries) {
  if (entries.length === 0) return [];
  return suite === "server" ? [`--test-skip-pattern=^${names(entries)}$`] : ["-t", `^(?!${names(entries)}$)`];
}

/**
 * A suite's arguments with the exclusion where its runner reads it: first for
 * node, which takes everything after its file list as the script's own
 * arguments; last for Vitest, whose subcommand (`vitest run …`) must come first.
 */
export function withExclusion(suite, args, entries) {
  const exclusion = excludeArgs(suite, entries);
  return suite === "server" ? [...exclusion, ...args] : [...args, ...exclusion];
}

/** The non-blocking run: only the quarantined tests, without coverage or shards. */
export function quarantinedCommand(suite, entries) {
  const pattern = `^${names(entries)}$`;
  return suite === "server"
    ? ["node", ["--import", "./test/helpers/openapiContract.ts", "--test", `--test-name-pattern=${pattern}`, "test/**/*.test.ts"]]
    : ["vitest", ["run", "-t", pattern]];
}

const today = () => new Date().toISOString().slice(0, 10);

/** Written to the job's summary when there is one, and to stdout either way. */
function report(markdown) {
  process.stdout.write(`${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

const describe = (entry) => `\`${entry.name}\` (${entry.suite}) — ${entry.reason}; owner ${entry.owner}, ${entry.issue}, expires ${entry.expires}`;

function check() {
  const { live, expired } = partition(parseQuarantine(readFileSync(FILE, "utf8")), today());
  for (const entry of live) process.stdout.write(`::notice title=Quarantined test::${describe(entry)}\n`);
  for (const entry of expired) {
    process.stdout.write(`::error title=Quarantine expired::${describe(entry)} — fix the test and remove the entry, or renew it with a reason\n`);
  }
  if (live.length + expired.length > 0) {
    report(["### Quarantined tests", "", ...[...live, ...expired].map((entry) => `- ${entry.expires < today() ? "**expired** " : ""}${describe(entry)}`)].join("\n"));
  }
  return expired.length === 0 ? 0 : 1;
}

function run(suite, command) {
  if (command.length === 0) throw new Error("run needs a command after --");
  const { live } = partition(parseQuarantine(readFileSync(FILE, "utf8")), today());
  const mine = live.filter((entry) => entry.suite === suite);
  const [program, ...args] = command;
  const blocking = spawnSync(program, withExclusion(suite, args, mine), { stdio: "inherit" });
  if (blocking.error) throw blocking.error;
  if (mine.length === 0) return blocking.status ?? 1;

  const [quarantinedProgram, quarantinedArgs] = quarantinedCommand(suite, mine);
  const quarantined = spawnSync(quarantinedProgram, quarantinedArgs, { stdio: "inherit" });
  report(
    [
      `### Quarantined ${suite} tests: ${quarantined.status === 0 ? "passed — maybe stable again" : "still failing (not blocking)"}`,
      "",
      ...mine.map((entry) => `- ${describe(entry)}`),
    ].join("\n"),
  );
  return blocking.status ?? 1;
}

if (process.argv[1]?.endsWith("quarantine.mjs")) {
  const [mode, suite] = process.argv.slice(2);
  const separator = process.argv.indexOf("--");
  try {
    if (mode === "check") process.exit(check());
    if (mode === "run" && (suite === "server" || suite === "dashboard")) {
      process.exit(run(suite, separator === -1 ? [] : process.argv.slice(separator + 1)));
    }
    throw new Error("usage: quarantine.mjs check | run <server|dashboard> -- <command…>");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
