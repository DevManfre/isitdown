import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stringify } from "yaml";
import { parseExceptions, partition } from "../../tools/cve-exceptions.mjs";

const entry = (over: Record<string, unknown> = {}) => ({
  id: "CVE-2026-12345",
  statement: "only reachable through a CLI flag IsItDown never passes",
  expired_at: "2026-12-31",
  ...over,
});

const file = (...entries: unknown[]) => stringify({ vulnerabilities: entries });

test("the shipped exceptions file is valid", () => {
  parseExceptions(readFileSync(new URL("../../.trivyignore.yaml", import.meta.url), "utf8"));
});

test("an entry with a reason, a date and Trivy's optional scoping is read as written", () => {
  const [read] = parseExceptions(file(entry({ paths: ["package-lock.json"] })));
  assert.deepEqual(read, entry({ paths: ["package-lock.json"] }));
  assert.equal(parseExceptions(file(entry({ id: "GHSA-2x3c-9wpf-mh4r" }))).length, 1);
});

test("an empty file and an empty list both accept nothing", () => {
  assert.deepEqual(parseExceptions(""), []);
  assert.deepEqual(parseExceptions("vulnerabilities:\n"), []);
  assert.deepEqual(parseExceptions("vulnerabilities: []\n"), []);
});

test("an entry without a reason or a real expiry date is refused", () => {
  for (const broken of [{ statement: "" }, { statement: "   " }, { statement: undefined }, { expired_at: undefined }, { expired_at: "next year" }]) {
    assert.throws(() => parseExceptions(file(entry(broken))), undefined, JSON.stringify(broken));
  }
});

test("an exception names one advisory, never a pattern that accepts them all", () => {
  for (const id of ["*", "CVE-*", "CVE-2026", "HIGH", ""]) {
    assert.throws(() => parseExceptions(file(entry({ id }))), undefined, id);
  }
});

test("only CVE exceptions belong in the file: unknown keys and other sections are refused", () => {
  assert.throws(() => parseExceptions(file(entry({ owner: "someone" }))));
  assert.throws(() => parseExceptions(stringify({ vulnerabilities: [], misconfigurations: [{ id: "DS002" }] })));
});

test("an entry is live through its expiry day and expired the day after", () => {
  const entries = [entry()];
  assert.equal(partition(entries, "2026-12-31").live.length, 1);
  assert.equal(partition(entries, "2027-01-01").expired.length, 1);
});
