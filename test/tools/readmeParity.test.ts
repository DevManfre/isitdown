import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareReadmes, counts, identifiers, pairsOf, sectionSkeleton } from "../../tools/readme-parity.mjs";

test("the section skeleton is the numbered headings, in order, with their level", () => {
  const skeleton = sectionSkeleton(["# IsItDown", "## 1. What it does", "### 1.2 Editions", "## Contents"].join("\n"));

  assert.deepEqual(skeleton, ["## 1", "### 1.2"]);
});

test("counts report headings per level, fences and table rows", () => {
  const md = ["## 1. One", "### 1.1 Two", "#### Deep", "```bash", "echo hi", "```", "| a | b |"].join("\n");

  assert.deepEqual(counts(md), { h2: 1, h3: 1, h4: 1, fences: 2, tables: 1 });
});

test("identifiers are the routes, shouted names and npm scripts a file names", () => {
  const md = "Call `/config/storage` with `DB_PATH` set, then `npm run build:ui`. Prose ignored.";

  assert.deepEqual(identifiers(md), ["/config/storage", "DB_PATH", "npm run build:ui"]);
});

test("two files with the same skeleton, counts and identifiers report nothing", () => {
  const source = ["## 1. Start", "Run `npm run build:ui`.", "| Key | Value |"].join("\n");
  const translation = ["## 1. Avvio", "Esegui `npm run build:ui`.", "| Chiave | Valore |"].join("\n");

  assert.deepEqual(compareReadmes(source, translation), []);
});

test("a section missing from the translation is reported with the heading that drifted", () => {
  const source = ["## 1. Start", "## 2. Next", "### 2.1 Detail"].join("\n");
  const translation = ["## 1. Avvio", "## 2. Poi"].join("\n");

  // The dropped heading is named, and its own count says one level is short.
  assert.match(compareReadmes(source, translation).join("\n"), /section only in README\.md: ### 2\.1/);
});

test("a table row dropped in the translation is reported as a count mismatch", () => {
  const source = ["## 1. Start", "| Key | Value |", "| `DB_PATH` | one |"].join("\n");
  const translation = ["## 1. Avvio", "| Chiave | Valore |"].join("\n");

  const findings = compareReadmes(source, translation);

  assert.equal(findings.length, 2);
  assert.match(findings.join("\n"), /tables: 2 vs 1/);
  // The identifier that row carried is gone too, and that is its own finding:
  // the count says something moved, this says what an operator would miss.
  assert.match(findings.join("\n"), /only in README\.md/);
});

test("an identifier the translation invented is reported as well", () => {
  const source = ["## 1. Start", "Set `DB_PATH`."].join("\n");
  const translation = ["## 1. Avvio", "Imposta `DB_PATH` e `DATA_PATH`."].join("\n");

  assert.match(compareReadmes(source, translation).join("\n"), /only in the translation: DATA_PATH/);
});

test("the repository's own READMEs are in sync", async () => {
  const [source, italian] = await Promise.all([
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
    readFile(new URL("../../README.it.md", import.meta.url), "utf8"),
  ]);

  assert.deepEqual(compareReadmes(source, italian), []);
});

// Roadmap 7.5. The manual is one file per section now, so the gate pairs each
// source with its own translation rather than comparing one README to another.
test("a directory listing pairs every source with the translations beside it", () => {
  const pairs = pairsOf(["README.md", "README.it.md", "CHANGELOG.md"]);

  assert.deepEqual(pairs, [{ source: "README.md", translations: ["README.it.md"] }]);
});

test("a source with no translation is not a pair: there is nothing to compare it to", () => {
  assert.deepEqual(pairsOf(["docs/orphan.md"]), []);
});

test("a prefix is carried into both halves, so docs/ pairs read as paths", () => {
  const pairs = pairsOf(["api.md", "api.it.md", "api.fr.md"], "docs/");

  assert.deepEqual(pairs, [
    { source: "docs/api.md", translations: ["docs/api.fr.md", "docs/api.it.md"] },
  ]);
});

test("the source file is named in a finding, so a drift says which pair drifted", () => {
  const findings = compareReadmes("## 1. Start\n## 2. Next", "## 1. Avvio", "docs/api.md");

  assert.match(findings.join("\n"), /section only in docs\/api\.md: ## 2/);
});
