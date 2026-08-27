import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../src/ui/web/locales/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`${lang}.json`, dir), "utf8")) as Record<string, string>;
const languages = files.map((name) => name.replace(".json", ""));

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

/** Assertions run against the code, not the prose that documents it. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

test("the dashboard ships an en source catalog and an it translation", () => {
  assert.ok(languages.includes("en"));
  assert.ok(languages.includes("it"));
});

test("every catalog has exactly the key set of en", () => {
  const expected = Object.keys(load("en")).sort();
  for (const language of languages) {
    assert.deepEqual(Object.keys(load(language)).sort(), expected, `catalog ${language} diverges`);
  }
});

test("every translated value carries the same placeholders as its en source", () => {
  const en = load("en");
  for (const language of languages) {
    if (language === "en") continue;
    const other = load(language);
    for (const [key, value] of Object.entries(en)) {
      assert.deepEqual(
        placeholders(other[key] ?? ""),
        placeholders(value),
        `${language}: placeholders of ${key} diverge from en`,
      );
    }
  }
});

test("no catalog value is empty", () => {
  for (const language of languages) {
    for (const [key, value] of Object.entries(load(language))) {
      assert.ok(value.trim().length > 0, `${language}: ${key} is empty`);
    }
  }
});

// i18next's own plural convention, not the vanilla dashboard's: a count-based
// key is suffixed with an underscore ("_one" / "_other"), not a dot.
test("plural keys come in one/other pairs so i18next can select by count", () => {
  const en = load("en");
  for (const key of Object.keys(en)) {
    if (key.endsWith("_one")) {
      assert.ok(`${key.slice(0, -4)}_other` in en, `${key} has no _other sibling`);
    }
    if (key.endsWith("_other")) {
      assert.ok(`${key.slice(0, -6)}_one` in en, `${key} has no _one sibling`);
    }
  }
});

test("every key the dashboard asks for exists in the en catalog", async () => {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const webDir = new URL("../../src/ui/web/", import.meta.url).pathname;

  async function sourceFiles(directory: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        // components/ui/ is scanned: dialog.tsx calls t("action.close") for the
        // two close labels stock shadcn hardcodes in English, so a generated
        // primitive's keys need checking like any other.
        if (entry.name === "node_modules") continue;
        found.push(...(await sourceFiles(path)));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(path);
    }
    return found;
  }

  const en = load("en");
  const missing: string[] = [];

  for (const file of await sourceFiles(webDir)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = strip(readFileSync(file, "utf8"));
    // Both ways a view asks for a key: `t("…")`, and the `i18nKey` of a
    // `<Trans>` — the form a sentence takes once the number inside it is a
    // `NumberTicker` in a `<0>` slot. A key reached only through `Trans` is as
    // able to be missing as any other.
    const asked = [...source.matchAll(/\bt\(\s*"([\w.-]+)"/g), ...source.matchAll(/\bi18nKey="([\w.-]+)"/g)];
    for (const match of asked) {
      const key = match[1] as string;
      // react-i18next resolves a count-bearing call ("t(key, { count })")
      // against `${key}_one` / `${key}_other`, never against the bare key —
      // but not every key called with a `count` interpolates a plural split
      // (e.g. "incident.last-polls" reads the same at any count), so a call
      // site is fine as long as EITHER form exists in the catalog.
      const known = key in en || (`${key}_one` in en && `${key}_other` in en);
      if (!known) missing.push(`${key} (in ${file})`);
    }
  }

  assert.deepEqual([...new Set(missing)], [], "a missing key renders as the key itself in the browser");
});

test("template keys built from a prefix resolve for every value they can take", () => {
  const en = load("en");
  // IncidentDetail.tsx renders `incident.timeline.${entry.label}` for the
  // labels the incidents route emits.
  for (const label of ["opened", "observed", "resolved"]) {
    assert.ok(`incident.timeline.${label}` in en, `incident.timeline.${label} is missing`);
  }
  // Header.tsx cycles through these three, and renders theme.<mode>.
  for (const mode of ["light", "dark", "system"]) {
    assert.ok(`theme.${mode}` in en, `theme.${mode} is missing`);
  }
});

/**
 * Key families the dashboard builds at runtime, so no literal `"key"` for them
 * ever appears in the tree. Each entry needs its own reason — a bare list
 * invites the next addition to go unjustified — and each is tightened by the
 * enumeration test below, which asserts the exact values each family can take.
 */
const DYNAMIC_FAMILIES: { prefix: string; reason: string }[] = [
  {
    prefix: "theme.",
    reason: "Header.tsx renders t(`theme.${mode}`) for the three modes it cycles through",
  },
  {
    prefix: "incident.timeline.",
    reason: "IncidentDetail.tsx renders t(`incident.timeline.${entry.label}`) for the labels the incidents route emits",
  },
];

/**
 * Catalog keys deliberately kept although nothing references them. Empty, and
 * meant to stay that way: the point of the test below is that a key with no
 * consumer gets deleted, not annotated. Every entry needs its own reason.
 */
const KEPT_UNUSED: Record<string, string> = {};

/**
 * The direction that was missing, and how seven dead keys accumulated. The test
 * above this one checks source → catalog ("every key the dashboard asks for
 * exists"), which catches a key that renders as its own name in the browser.
 * Nothing checked catalog → source, so a key whose call site was dropped in a
 * rewrite just sat there — and among the seven were two *lost affordances*
 * rather than dead weight: `action.retry`, for a retry button ViewError never
 * had, and `column.range`, for a range label History rendered as an
 * untranslated "7d". A dead key is not only clutter; it is sometimes the only
 * remaining trace of a feature that went missing.
 *
 * The scan is deliberately broader than `t("…")`: a key can reach `t()` through
 * a constant (`NAV_ROUTES`'s `labelKey`, `TITLE_KEYS`, `STATUS_CHART`'s
 * `labelKey`), so any string literal that equals a catalog key counts as a
 * reference.
 *
 * Test files are deliberately NOT scanned. A key asserted only by its own test
 * is still dead: nothing renders it. Counting tests would mean that deleting a
 * call site while leaving its test's `i18n.t("key")` behind kept the key
 * looking alive — which is precisely the shape of the thing this test exists to
 * catch. Nothing in the catalog relies on a test-only reference today, so the
 * tighter rule costs nothing.
 */
test("every key in the en catalog is rendered somewhere in the dashboard", async () => {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  async function tsFiles(directory: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "locales") continue;
        found.push(...(await tsFiles(path)));
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        found.push(path);
      }
    }
    return found;
  }

  const webDir = new URL("../../src/ui/web/", import.meta.url).pathname;
  const sources = (await tsFiles(webDir)).map((file) => strip(readFileSync(file, "utf8"))).join("\n");
  const referenced = new Set([...sources.matchAll(/"([\w.-]+)"/g)].map((match) => match[1] as string));

  const orphans = Object.keys(load("en")).filter((key) => {
    if (key in KEPT_UNUSED) return false;
    if (DYNAMIC_FAMILIES.some((family) => key.startsWith(family.prefix))) return false;
    if (referenced.has(key)) return false;
    // A plural pair is reached as t("base", { count }), never by its own suffix.
    return !referenced.has(key.replace(/_(one|other)$/, ""));
  });

  assert.deepEqual(
    orphans,
    [],
    "delete these from both catalogs — or, if the affordance was meant to exist, build it",
  );
});
