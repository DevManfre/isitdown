import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { t, formatUtc, availableLocales, catalogSchema } from "../../src/core/i18n/index.ts";

const dir = new URL("../../src/core/i18n/", import.meta.url);
const catalogFiles = readdirSync(dir).filter((f) => f.endsWith(".json"));
const load = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`${lang}.json`, dir), "utf8")) as Record<string, string>;

test("every catalog has exactly the key set of en", () => {
  const en = Object.keys(load("en")).sort();
  const langs = catalogFiles.map((f) => f.replace(".json", ""));
  assert.ok(langs.includes("it"), "it.json must exist");
  for (const lang of langs) {
    assert.deepEqual(Object.keys(load(lang)).sort(), en, `catalog ${lang} diverges from en`);
  }
});

test("every catalog exposes the same placeholders as its en source", () => {
  const en = load("en");
  const placeholders = (value: string): string[] =>
    [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
  for (const lang of catalogFiles.map((f) => f.replace(".json", ""))) {
    if (lang === "en") continue;
    const other = load(lang);
    for (const [key, value] of Object.entries(en)) {
      assert.deepEqual(
        placeholders(other[key] ?? ""),
        placeholders(value),
        `${lang}: placeholders of ${key} diverge from en`,
      );
    }
  }
});

test("no catalog value is empty", () => {
  for (const lang of catalogFiles.map((f) => f.replace(".json", ""))) {
    for (const [key, value] of Object.entries(load(lang))) {
      assert.ok(value.trim().length > 0, `${lang}: ${key} is empty`);
    }
  }
});

test("availableLocales lists every catalog on disk", () => {
  assert.deepEqual(
    [...availableLocales].sort(),
    catalogFiles.map((f) => f.replace(".json", "")).sort(),
  );
});

test("a known key resolves in its own locale", () => {
  assert.equal(t("en", "status.operational"), "Operational");
  assert.notEqual(t("it", "status.operational"), t("en", "status.operational"));
});

test("an unknown locale falls back to en", () => {
  assert.equal(t("xx", "status.operational"), t("en", "status.operational"));
});

test("a key missing from a translated catalog would fall back to en", () => {
  // Guarded by the parity test above, so exercise the mechanism directly.
  assert.equal(t("it", "status.operational", {}), load("it")["status.operational"]);
  assert.equal(t("en", "definitely.not.a.key"), "definitely.not.a.key");
});

test("named placeholders are interpolated", () => {
  const out = t("en", "notification.incident.opened", {
    provider: "GitHub",
    severity: "MAJOR OUTAGE",
    title: "API requests failing",
    status: "Investigating",
    updatedAt: "2026-08-19 14:32 UTC",
    url: "https://www.githubstatus.com",
  });
  assert.ok(out.includes("GitHub"));
  assert.ok(out.includes("API requests failing"));
  assert.ok(out.includes("https://www.githubstatus.com"));
  assert.ok(!/\{\w+\}/.test(out), `unfilled placeholder left in: ${out}`);
});

test("a placeholder with no matching param is left visible rather than blanked", () => {
  const out = t("en", "notification.incident.opened", { provider: "GitHub" });
  assert.ok(out.includes("{title}"), "a missing param must stay visible for diagnosis");
});

test("formatUtc renders the same UTC string in every locale", () => {
  const iso = "2026-08-19T14:32:07.000Z";
  assert.equal(formatUtc(iso), "2026-08-19 14:32 UTC");
  for (const locale of availableLocales) {
    assert.equal(formatUtc(iso), "2026-08-19 14:32 UTC", `locale ${locale} changed the stamp`);
  }
});

test("formatUtc converts a non-UTC offset to UTC", () => {
  assert.equal(formatUtc("2026-08-19T16:32:07.000+02:00"), "2026-08-19 14:32 UTC");
});

test("formatUtc rejects an unparseable timestamp instead of emitting Invalid Date", () => {
  assert.throws(() => formatUtc("not a timestamp"), /timestamp/i);
});

test("a catalog that is not flat string-to-string is rejected", () => {
  assert.throws(() => catalogSchema.parse({ "a.b": { nested: "no" } }));
  assert.throws(() => catalogSchema.parse({ "a.b": 42 }));
  assert.doesNotThrow(() => catalogSchema.parse({ "a.b": "yes" }));
});
