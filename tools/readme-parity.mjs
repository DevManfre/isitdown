// Documentation translation gate — roadmap 7.6, widened by 7.5.
//
// `README.md` and every file under `docs/` are the source; each has a
// `<name>.<lang>.md` beside it, a translation of it section for section. The
// `readme-translation-sync` skill already carries the three commands that catch a
// drifted translation; this is those commands as a check CI can run, so an
// unsynced hand edit cannot reach `main`.
//
// One pair at a time rather than the whole manual concatenated: a section moved
// from one file to another is a real drift, and comparing the sum would hide it.
//
// It compares structure, never meaning: the numbered heading skeleton, the
// per-level heading, fence and table-row counts, and the identifiers each file
// names — a route, a shouted env var, an npm script. An identifier is copied
// verbatim in a translation, so one present in only one file is either a
// missing section or a translated flag, and both are defects.
//
// CLI: node tools/readme-parity.mjs
import { readdir, readFile } from "node:fs/promises";

const SOURCE = "README.md";

/** `docs/api.it.md` is a translation of `docs/api.md`; `docs/api.md` is not. */
const TRANSLATION = /^(.+)\.([a-z]{2})\.md$/;

/** `## 3.` / `### 3.1` — the level and the number, which is what must line up. */
const NUMBERED_HEADING = /^(#+) ([0-9]+(?:\.[0-9]+)*)\.?(?=\s|$)/;

/**
 * Identifiers a translation copies rather than translates: absolute paths and
 * routes, SHOUTED_NAMES of four characters or more, and npm scripts. Narrow on
 * purpose — a wider pattern picks up example values, which legitimately differ.
 */
const IDENTIFIER = /`(\/[a-z0-9/:._-]+|[A-Z][A-Z0-9_]{3,}|npm run [a-z:]+)`/g;

/**
 * @param {string} markdown
 * @returns {string[]} one `"### 3.1"` per numbered heading, in document order
 */
export function sectionSkeleton(markdown) {
  const skeleton = [];
  for (const line of markdown.split("\n")) {
    const match = NUMBERED_HEADING.exec(line);
    if (match !== null) skeleton.push(`${match[1]} ${match[2]}`);
  }
  return skeleton;
}

/**
 * @param {string} markdown
 * @returns {{ h2: number, h3: number, h4: number, fences: number, tables: number }}
 */
export function counts(markdown) {
  const lines = markdown.split("\n");
  const starting = (prefix) => lines.filter((line) => line.startsWith(prefix)).length;
  return {
    h2: starting("## "),
    h3: starting("### "),
    h4: starting("#### "),
    fences: starting("```"),
    tables: starting("|"),
  };
}

/**
 * @param {string} markdown
 * @returns {string[]} every identifier the file names, sorted, without repeats
 */
export function identifiers(markdown) {
  return [...new Set([...markdown.matchAll(IDENTIFIER)].map((match) => match[1]))].sort();
}

/**
 * @param {string} source `README.md`
 * @param {string} translation one `README.<lang>.md`
 * @returns {string[]} one line per drift, empty when the two are in sync
 */
export function compareReadmes(source, translation, sourceName = SOURCE) {
  const findings = [];

  const [left, right] = [sectionSkeleton(source), sectionSkeleton(translation)];
  for (const heading of left) {
    if (!right.includes(heading)) findings.push(`section only in ${sourceName}: ${heading}`);
  }
  for (const heading of right) {
    if (!left.includes(heading)) findings.push(`section only in the translation: ${heading}`);
  }
  // Order matters as much as membership: a section ported into the wrong place
  // reads as a different document even though every heading is present.
  if (findings.length === 0 && left.join("\n") !== right.join("\n")) {
    findings.push(`the numbered sections are in a different order (${sourceName} leads with ${left[0]})`);
  }

  const [sourceCounts, translationCounts] = [counts(source), counts(translation)];
  for (const key of Object.keys(sourceCounts)) {
    if (sourceCounts[key] !== translationCounts[key]) {
      findings.push(`${key}: ${sourceCounts[key]} vs ${translationCounts[key]}`);
    }
  }

  const [sourceIds, translationIds] = [identifiers(source), identifiers(translation)];
  const missing = sourceIds.filter((id) => !translationIds.includes(id));
  const extra = translationIds.filter((id) => !sourceIds.includes(id));
  if (missing.length > 0) findings.push(`only in ${sourceName}: ${missing.join(", ")}`);
  if (extra.length > 0) findings.push(`only in the translation: ${extra.join(", ")}`);

  return findings;
}

/**
 * Every source file that has at least one translation beside it, as
 * `{ source, translations }` pairs — `README.md` and each `docs/*.md`.
 *
 * @param {string[]} names every file in one directory
 * @param {string} prefix how to write a name relative to the repository root
 * @returns {{ source: string, translations: string[] }[]}
 */
export function pairsOf(names, prefix = "") {
  const markdown = names.filter((name) => name.endsWith(".md"));
  const sources = markdown.filter((name) => !TRANSLATION.test(name)).sort();
  return sources
    .map((source) => ({
      source: `${prefix}${source}`,
      translations: markdown
        .filter((name) => {
          const match = TRANSLATION.exec(name);
          return match !== null && `${match[1]}.md` === source;
        })
        .sort()
        .map((name) => `${prefix}${name}`),
    }))
    .filter((pair) => pair.translations.length > 0);
}

if (process.argv[1]?.endsWith("readme-parity.mjs")) {
  const root = new URL("../", import.meta.url);
  const pairs = [
    ...pairsOf(await readdir(root)),
    ...pairsOf(await readdir(new URL("docs/", root)), "docs/"),
  ];

  let failed = false;
  for (const { source, translations } of pairs) {
    const left = await readFile(new URL(source, root), "utf8");
    for (const name of translations) {
      const findings = compareReadmes(left, await readFile(new URL(name, root), "utf8"), source);
      if (findings.length === 0) {
        process.stdout.write(`${name} is in sync with ${source}\n`);
        continue;
      }
      failed = true;
      process.stdout.write(`${name} has drifted from ${source}:\n`);
      for (const finding of findings) process.stdout.write(`  ${finding}\n`);
    }
  }
  if (pairs.length === 0) {
    process.stdout.write("no translated markdown found — nothing to compare\n");
  }
  process.exit(failed ? 1 : 0);
}
