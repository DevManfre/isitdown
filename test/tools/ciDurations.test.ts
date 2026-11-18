import { test } from "node:test";
import assert from "node:assert/strict";
import { CEILINGS, summarize } from "../../tools/ci-durations.mjs";

const job = (name: string, seconds: number | null) => ({
  name,
  started_at: "2026-11-17T10:00:00Z",
  completed_at: seconds === null ? null : new Date(Date.parse("2026-11-17T10:00:00Z") + seconds * 1000).toISOString(),
});

test("every job gets a row with what it took and its ceiling", () => {
  const { markdown, over } = summarize([job("Server tests (node:test, coverage) + integration", 119)]);
  assert.match(markdown, /\| Server tests \(node:test, coverage\) \+ integration \| 1m 59s \| 3m 20s \| ok \|/);
  assert.deepEqual(over, []);
});

test("a job over its ceiling is named, with both figures", () => {
  const { markdown, over } = summarize([job("Typecheck, lint, README parity", 90)]);
  assert.match(markdown, /\| 1m 30s \| 1m 15s \| \*\*over\*\* \|/);
  assert.deepEqual(over, [{ name: "Typecheck, lint, README parity", seconds: 90, ceiling: 75 }]);
});

test("each shard of a matrix job is held to the same ceiling", () => {
  const { over } = summarize([job("Dashboard tests (Vitest, shard 1/2)", 100), job("Dashboard tests (Vitest, shard 2/2)", 130)]);
  assert.deepEqual(over.map((entry) => entry.name), ["Dashboard tests (Vitest, shard 2/2)"]);
});

test("a job with no ceiling is shown as such rather than silently passing, and a running one is left out", () => {
  const { markdown, over } = summarize([job("A job added later", 30), job("verify", null)]);
  assert.match(markdown, /\| A job added later \| 30s \| — \| no ceiling set \|/);
  assert.doesNotMatch(markdown, /verify/);
  assert.deepEqual(over, []);
});

test("every job ci.yml defines today has a ceiling", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const names = [...workflow.matchAll(/^ {4}name: (.+)$/gm)].map((match) => (match[1] ?? "").replace("${{ matrix.shard }}", "1"));
  assert.ok(names.length >= 5, `found ${names.length} job names`);
  for (const name of names) assert.ok(CEILINGS.some((entry) => entry.match.test(name)), `${name} has no ceiling`);
});
