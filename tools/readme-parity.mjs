// README translation gate — roadmap 7.6.
//
// `README.md` is the source; every `README.<lang>.md` is a translation of it,
// section for section. The `readme-translation-sync` skill already carries the
// three commands that catch a drifted translation; this is those commands as a
// check CI can run, so an unsynced hand edit cannot reach `main`.
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
export function compareReadmes(source, translation) {
  const findings = [];

  const [left, right] = [sectionSkeleton(source), sectionSkeleton(translation)];
  for (const heading of left) {
    if (!right.includes(heading)) findings.push(`section only in ${SOURCE}: ${heading}`);
  }
  for (const heading of right) {
    if (!left.includes(heading)) findings.push(`section only in the translation: ${heading}`);
  }
  // Order matters as much as membership: a section ported into the wrong place
  // reads as a different document even though every heading is present.
  if (findings.length === 0 && left.join("\n") !== right.join("\n")) {
    findings.push(`the numbered sections are in a different order (${SOURCE} leads with ${left[0]})`);
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
  if (missing.length > 0) findings.push(`only in ${SOURCE}: ${missing.join(", ")}`);
  if (extra.length > 0) findings.push(`only in the translation: ${extra.join(", ")}`);

  return findings;
}

if (process.argv[1]?.endsWith("readme-parity.mjs")) {
  const root = new URL("../", import.meta.url);
  const source = await readFile(new URL(SOURCE, root), "utf8");
  const translations = (await readdir(root)).filter((name) => /^README\.[a-z]{2}\.md$/.test(name)).sort();

  let failed = false;
  for (const name of translations) {
    const findings = compareReadmes(source, await readFile(new URL(name, root), "utf8"));
    if (findings.length === 0) {
      process.stdout.write(`${name} is in sync with ${SOURCE}\n`);
      continue;
    }
    failed = true;
    process.stdout.write(`${name} has drifted from ${SOURCE}:\n`);
    for (const finding of findings) process.stdout.write(`  ${finding}\n`);
  }
  if (translations.length === 0) {
    process.stdout.write(`no README.<lang>.md beside ${SOURCE} — nothing to compare\n`);
  }
  process.exit(failed ? 1 : 0);
}
