// Orphan i18n keys — roadmap 13.5.
//
// Every refactor leaves a few catalog keys behind that no code asks for any
// more, and every new translation then translates them for nothing. The
// parity test (test/ui/locales.test.ts) keeps the catalogs in step with each
// other; this check keeps them in step with the code.
//
// Two catalogs, two scopes:
//   - dashboard: src/ui/web/locales/*.json, read by the React tree's `t("…")`
//     and `<Trans i18nKey="…">`
//   - server:    src/core/i18n/*.json, read by core, notifiers, Light and the
//     CLI through `t(locale, "…")`
//
// A key counts as used when any source file under src/ mentions it as a whole
// string literal (so `labelKey: "nav.overview"` passed on to `t(labelKey)` is
// seen), when a template literal could build it (`t(\`theme.${mode}\`)` uses
// every `theme.*` key), when it is a plural form (`_one`, `_other`, …) of a
// used base, or when tools/i18n-orphans.allow.json lists it or a prefix of it —
// that file is for the keys built in a way no literal shows.
//
// Two findings, two severities:
//   - orphan  — in en.json, never used: a warning (CI annotates it) that
//               `--fix` resolves by removing the key from every catalog of
//               that scope at once
//   - missing — a `t("…")` call names a key en.json does not have: an error,
//               exit 1, because the user would see the raw key
//
// CLI: node tools/i18n-orphans.mjs [--fix]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** i18next's plural suffixes; a catalog can carry any of them for one base. */
const PLURAL = /_(zero|one|two|few|many|other)$/;

export const SCOPES = [
  {
    name: "dashboard",
    catalogDir: "src/ui/web/locales",
    /** where a `t("…")` call resolves against this catalog */
    owns: (file) => file.startsWith("src/ui/web/"),
  },
  {
    name: "server",
    catalogDir: "src/core/i18n",
    owns: (file) => !file.startsWith("src/ui/web/"),
  },
];

const SOURCE = /\.(ts|tsx|mjs|js)$/;
const TEST = /\.(test|itest)\.(ts|tsx)$/;

/** Every production source file under `root`, repo-relative, `/`-separated. */
export function sourceFiles(root = "src") {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "node_modules") walk(path);
      } else if (SOURCE.test(name) && !TEST.test(name) && !name.endsWith(".d.ts")) {
        out.push(relative(".", path).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What one source file says about keys.
 *
 * @param {string} source
 * @returns {{ literals: Set<string>, patterns: RegExp[], calls: string[] }}
 *   literals — every plain string literal; patterns — one per template literal
 *   with an interpolation, matching whatever it could build; calls — the keys
 *   named literally by `t("…")`, `t(locale, "…")` or `i18nKey="…"`
 */
export function scanSource(source) {
  // Not a tokenizer: a key is a run of key characters with a quote right on
  // either side. An apostrophe in a comment cannot shift the pairing this
  // way, and a run of key characters never spans the gap between two
  // separate literals.
  const literals = new Set();
  for (const match of source.matchAll(/(?<=["'`])[\w.-]+(?=["'`])/g)) literals.add(match[0]);

  const patterns = [];
  for (const match of source.matchAll(/`([^`]*)`/g)) {
    const body = match[1] ?? "";
    if (!body.includes("${")) continue;
    // Static pieces stay literal, each `${…}` becomes "one or more key
    // characters". Only a template that opens on a key-shaped namespace
    // (`theme.${mode}`) counts: `${a}.${b}` would match every key there is,
    // and hide every orphan with it — a key built that way goes in the
    // allowlist instead.
    const pieces = body.split(/\$\{[^}]*\}/);
    if (!/^[a-zA-Z][\w-]*\./.test(pieces[0] ?? "")) continue;
    patterns.push(new RegExp(`^${pieces.map(escapeRegExp).join("[\\w.-]+")}$`));
  }

  const calls = [];
  for (const match of source.matchAll(
    /\bt\(\s*(?:[\w.[\]]+\s*,\s*)?"([\w.-]+)"|\bi18nKey=\{?"([\w.-]+)"/g,
  )) {
    calls.push(match[1] ?? match[2] ?? "");
  }
  return { literals, patterns, calls };
}

/**
 * @param {string[]} keys        en.json's keys for one scope
 * @param {{ literals: Set<string>, patterns: RegExp[] }} usage  merged over all sources
 * @param {string[]} calls       keys named by `t("…")` calls in this scope's files
 * @param {{ keys?: string[], prefixes?: string[] }} allow
 * @returns {{ orphans: string[], missing: string[] }}
 */
export function analyse(keys, usage, calls, allow = {}) {
  const allowKeys = new Set(allow.keys ?? []);
  const prefixes = allow.prefixes ?? [];
  const isUsed = (key) =>
    usage.literals.has(key) ||
    allowKeys.has(key) ||
    prefixes.some((prefix) => key.startsWith(prefix)) ||
    usage.patterns.some((pattern) => pattern.test(key));
  const orphans = keys.filter((key) => {
    if (isUsed(key)) return false;
    const base = key.replace(PLURAL, "");
    return base === key || !isUsed(base);
  });

  const present = new Set(keys);
  for (const key of keys) present.add(key.replace(PLURAL, ""));
  const missing = [...new Set(calls)].filter((key) => !present.has(key)).sort();
  return { orphans: orphans.sort(), missing };
}

/**
 * Removes `keys` from a one-key-per-line catalog without reformatting it, so
 * the diff is exactly the deleted lines.
 *
 * @param {string} text
 * @param {Set<string>} keys
 */
export function removeKeys(text, keys) {
  const kept = text.split("\n").filter((line) => {
    const match = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(line);
    return match === null || !keys.has(JSON.parse(`"${match[1]}"`));
  });
  // The removed line may have been the last entry: drop the comma it leaves
  // dangling, and any blank group separator left right before the brace.
  let out = kept.join("\n");
  out = out.replace(/,(\s*)\n}/, "\n}").replace(/\n\n+}/, "\n}");
  // A group whose every key went leaves two separators side by side.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

function loadAllow() {
  try {
    return JSON.parse(readFileSync("tools/i18n-orphans.allow.json", "utf8"));
  } catch {
    return {};
  }
}

function main(argv) {
  const fix = argv.includes("--fix");
  const annotate = process.env.GITHUB_ACTIONS === "true";
  const allow = loadAllow();

  const files = sourceFiles();
  const scanned = files.map((file) => ({ file, ...scanSource(readFileSync(file, "utf8")) }));
  const usage = { literals: new Set(), patterns: [] };
  for (const { literals, patterns } of scanned) {
    for (const literal of literals) usage.literals.add(literal);
    usage.patterns.push(...patterns);
  }

  let failed = false;
  for (const scope of SCOPES) {
    const enPath = join(scope.catalogDir, "en.json");
    const keys = Object.keys(JSON.parse(readFileSync(enPath, "utf8")));
    const calls = scanned.filter(({ file }) => scope.owns(file)).flatMap(({ calls }) => calls);
    const { orphans, missing } = analyse(keys, usage, calls, allow[scope.name]);

    for (const key of missing) {
      const where = scanned.find(({ file, calls }) => scope.owns(file) && calls.includes(key))?.file;
      if (annotate) console.log(`::error file=${where}::i18n key "${key}" is not in ${enPath}`);
      console.log(`✗ ${scope.name}: "${key}" used in ${where} but missing from ${enPath}`);
    }
    failed ||= missing.length > 0;

    if (orphans.length === 0) {
      console.log(`✓ ${scope.name}: ${keys.length} keys, no orphans`);
    } else if (fix) {
      const drop = new Set(orphans);
      const catalogs = readdirSync(scope.catalogDir).filter((name) => name.endsWith(".json"));
      for (const name of catalogs) {
        const path = join(scope.catalogDir, name);
        const before = readFileSync(path, "utf8");
        const after = removeKeys(before, drop);
        JSON.parse(after); // never write a catalog that no longer parses
        writeFileSync(path, after);
      }
      console.log(`✓ ${scope.name}: removed ${orphans.length} orphan keys from ${catalogs.length} catalogs`);
    } else {
      for (const key of orphans) {
        if (annotate) console.log(`::warning file=${enPath}::i18n key "${key}" is used nowhere in src/`);
        console.log(`! ${scope.name}: orphan "${key}"`);
      }
      console.log(`! ${scope.name}: ${orphans.length} orphan keys — \`npm run check:i18n -- --fix\` removes them`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
