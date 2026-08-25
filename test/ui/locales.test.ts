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
        if (entry.name === "ui") continue; // shadcn-generated primitives, never call t()
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
    for (const match of source.matchAll(/\bt\(\s*"([\w.-]+)"/g)) {
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
