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
