#!/usr/bin/env node
/**
 * Mutation testing for the diff engine — roadmap 7.3.
 *
 * Coverage says a line ran. It does not say a test would have noticed had the
 * line been wrong, and the diff engine is the one place in this codebase where
 * that difference is dangerous: it is the single authority on whether anybody
 * is told anything, so a suite that executes it without constraining it would
 * look exactly like a suite that guards it.
 *
 * So: change one operator in the source, run the engine's own tests, and see
 * whether they go red. A mutant the suite still passes is a survivor — a claim
 * about the engine nothing is holding it to. The engine is small enough that
 * doing this exhaustively costs about a minute.
 *
 * No dependency: the mutations are textual, applied only at positions that are
 * really code (comments and string literals are masked out first), and each
 * mutant is run by writing it to the real path, spawning the test runner, and
 * restoring the original — which is also what a crash or a Ctrl-C has to undo,
 * hence the restore handlers at the bottom.
 *
 *   node tools/mutation.mjs              # every target
 *   node tools/mutation.mjs --list       # what would be run, and nothing else
 *   node tools/mutation.mjs --only=<substring of the mutation's description>
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * What gets mutated, and which suites have to object. Kept narrow on purpose:
 * this is a claim about the engine's own tests, so running the whole suite
 * would let an unrelated test's incidental coverage do the guarding.
 */
const TARGETS = [
  {
    source: "src/core/diffEngine.ts",
    tests: ["test/core/diffEngine.test.ts"],
  },
];

/**
 * One operator swapped for the one next to it. Each pair is a mistake somebody
 * could actually make — an off-by-one boundary, an inverted comparison, a
 * confused connective — rather than a random edit: a survivor is only worth
 * reading if the mutation describes a plausible bug.
 *
 * Longest patterns first, so `!==` is never matched as `=` and `<=` never as
 * `<`.
 */
const OPERATORS = [
  ["!==", "==="],
  ["===", "!=="],
  [">=", ">"],
  ["<=", "<"],
  ["&&", "||"],
  ["||", "&&"],
  [" > ", " >= "],
  [" < ", " <= "],
  [" + 1", " - 1"],
  ["true", "false"],
  ["false", "true"],
];

/**
 * Which characters are code. A textual mutation that lands inside a comment
 * changes nothing and reports a false survivor; one that lands inside a string
 * changes a message rather than a decision, which is a different test's job.
 */
function codeMask(source) {
  const mask = new Array(source.length).fill(true);
  let state = "code";
  let index = 0;

  const hide = (from, to) => {
    for (let i = from; i < to && i < mask.length; i += 1) mask[i] = false;
  };

  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (state === "code") {
      if (two === "//") {
        const end = source.indexOf("\n", index);
        const stop = end === -1 ? source.length : end;
        hide(index, stop);
        index = stop;
        continue;
      }
      if (two === "/*") {
        const end = source.indexOf("*/", index + 2);
        const stop = end === -1 ? source.length : end + 2;
        hide(index, stop);
        index = stop;
        continue;
      }
      const char = source[index];
      if (char === '"' || char === "'" || char === "`") {
        state = char;
        mask[index] = false;
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    // Inside a string literal: everything is hidden until the matching quote,
    // and a backslash hides the character it escapes along with itself.
    mask[index] = false;
    if (source[index] === "\\") {
      if (index + 1 < mask.length) mask[index + 1] = false;
      index += 2;
      continue;
    }
    if (source[index] === state) state = "code";
    index += 1;
  }

  return mask;
}

/**
 * Operators declared equivalent on the line below, keyed by line number.
 *
 * Some mutations cannot be killed because they cannot be observed: swapping the
 * connective in `if (x === null || x === undefined) return false` changes
 * nothing when the code below it already answers `false` for both. A tool with
 * no way to say so either reports a permanent survivor — which trains everyone
 * to ignore the report — or invites a test asserting something untrue. So the
 * source says it, in a comment a reader gets the reason from too:
 *
 *   // mutation-equivalent: || — both sides reach the same answer downstream
 *
 * It suppresses only the named operators, and only on the next line that is
 * code, so the other mutations there still have to be killed and a reason that
 * runs to two lines still lands on the right one.
 */
function equivalences(source) {
  const lines = source.split("\n");
  const declared = new Map();

  lines.forEach((text, index) => {
    const match = /\/\/\s*mutation-equivalent:\s*([^\u2014-]+)/.exec(text);
    if (match === null) return;
    const operators = match[1].split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");

    let target = index + 1;
    while (target < lines.length && /^\s*(\/\/|$)/.test(lines[target])) target += 1;
    // Line numbers are 1-based.
    declared.set(target + 1, new Set(operators));
  });

  return declared;
}

/** Every mutant a target yields, in source order. */
function mutantsOf(target) {
  const source = readFileSync(target.source, "utf8");
  const mask = codeMask(source);
  const declared = equivalences(source);
  const mutants = [];
  let equivalent = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (!mask[index]) continue;
    for (const [from, to] of OPERATORS) {
      if (!source.startsWith(from, index)) continue;
      if (!mask[index + from.length - 1]) continue;
      // A word-shaped pattern must be a whole word: `trueish` is not `true`.
      if (/^[a-z]+$/.test(from) && /[A-Za-z0-9_$]/.test(source[index - 1] ?? "")) break;
      if (/^[a-z]+$/.test(from) && /[A-Za-z0-9_$]/.test(source[index + from.length] ?? "")) break;

      const line = source.slice(0, index).split("\n").length;
      if (declared.get(line)?.has(from) === true) {
        equivalent += 1;
        break;
      }

      mutants.push({
        target,
        index,
        from,
        to,
        line,
        mutated: source.slice(0, index) + to + source.slice(index + from.length),
      });
      // One mutation per position: the operator list is ordered longest-first,
      // so the first match is the specific one.
      break;
    }
  }

  return { source, mutants, equivalent };
}

const describe = (mutant) =>
  `${mutant.target.source}:${mutant.line} ${JSON.stringify(mutant.from)} -> ${JSON.stringify(mutant.to)}`;

/** Whether the suite objects. A non-zero exit is the objection. */
function suiteFails(target) {
  const result = spawnSync(process.execPath, ["--test", ...target.tests], {
    stdio: "ignore",
    env: process.env,
  });
  return result.status !== 0;
}

function main() {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const listing = args.includes("--list");

  const survivors = [];
  let killed = 0;
  let total = 0;
  let equivalent = 0;

  for (const target of TARGETS) {
    const { source, mutants, equivalent: declared } = mutantsOf(target);
    equivalent += declared;
    const selected = only === undefined ? mutants : mutants.filter((m) => describe(m).includes(only));

    if (listing) {
      for (const mutant of selected) process.stdout.write(`${describe(mutant)}\n`);
      continue;
    }

    // The baseline has to be green, or every mutant "dies" for the wrong reason
    // and the run reports a perfect score it did not earn.
    if (suiteFails(target)) {
      process.stderr.write(`${target.tests.join(", ")} fails before any mutation — fix that first\n`);
      process.exitCode = 1;
      return;
    }

    for (const mutant of selected) {
      total += 1;
      try {
        writeFileSync(target.source, mutant.mutated);
        if (suiteFails(target)) {
          killed += 1;
          process.stdout.write(".");
        } else {
          survivors.push(mutant);
          process.stdout.write("S");
        }
      } finally {
        writeFileSync(target.source, source);
      }
    }
  }

  if (listing) return;

  // The declared ones are reported rather than quietly subtracted: a score that
  // hides how much of the source was excused from it is not a score.
  process.stdout.write(
    `\n\n${killed}/${total} mutants killed` +
      (equivalent === 0 ? "\n" : `, ${equivalent} declared equivalent in the source\n`),
  );
  if (survivors.length === 0) return;

  process.stdout.write(`\n${survivors.length} survived — the suite does not constrain these:\n`);
  for (const mutant of survivors) process.stdout.write(`  ${describe(mutant)}\n`);
  process.exitCode = 1;
}

// A mutant on disk is a broken source file, so every way out of this process
// has to put the original back — including the ones that skip the `finally`
// above.
const originals = new Map(TARGETS.map((target) => [target.source, readFileSync(target.source, "utf8")]));
const restore = () => {
  for (const [path, content] of originals) writeFileSync(path, content);
};
process.on("exit", restore);
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

main();
