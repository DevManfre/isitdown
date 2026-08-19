import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../src/ui/public/locales/", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`${lang}.json`, dir), "utf8")) as Record<string, string>;
const languages = files.map((name) => name.replace(".json", ""));

const placeholders = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

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

test("plural keys come in one/other pairs so Intl.PluralRules can select", () => {
  const en = load("en");
  for (const key of Object.keys(en)) {
    if (key.endsWith(".one")) {
      assert.ok(`${key.slice(0, -4)}.other` in en, `${key} has no .other sibling`);
    }
    if (key.endsWith(".other")) {
      assert.ok(`${key.slice(0, -6)}.one` in en, `${key} has no .one sibling`);
    }
  }
});

test("every key the dashboard asks for exists in the en catalog", async () => {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const publicDir = new URL("../../src/ui/public/", import.meta.url).pathname;

  async function jsFiles(directory: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) found.push(...(await jsFiles(path)));
      else if (entry.name.endsWith(".js")) found.push(path);
    }
    return found;
  }

  const en = load("en");
  const missing: string[] = [];

  for (const file of await jsFiles(join(publicDir, "js"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*"([\w.-]+)"/g)) {
      const key = match[1] as string;
      if (!(key in en)) missing.push(`${key} (in ${file})`);
    }
    // A plural lookup resolves base.one / base.other rather than the base itself.
    for (const match of source.matchAll(/tPlural\(\s*"([\w.-]+)"/g)) {
      const base = match[1] as string;
      for (const form of ["one", "other"]) {
        if (!(`${base}.${form}` in en)) missing.push(`${base}.${form} (in ${file})`);
      }
    }
  }

  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  for (const match of html.matchAll(/data-i18n(?:-\w+)?="([\w.-]+)"/g)) {
    const key = match[1] as string;
    if (!(key in en)) missing.push(`${key} (in index.html)`);
  }

  assert.deepEqual([...new Set(missing)], [], "a missing key renders as the key itself in the browser");
});

test("template keys built from a prefix resolve for every value they can take", () => {
  const en = load("en");
  // incident.js renders `incident.timeline.${entry.label}` for the labels the
  // incidents route emits.
  for (const label of ["opened", "observed", "resolved"]) {
    assert.ok(`incident.timeline.${label}` in en, `incident.timeline.${label} is missing`);
  }
  // theme.js cycles through these three, and the header renders theme.<mode>.
  for (const mode of ["light", "dark", "system"]) {
    assert.ok(`theme.${mode}` in en, `theme.${mode} is missing`);
  }
});
