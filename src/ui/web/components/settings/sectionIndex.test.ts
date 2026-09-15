import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { openCategory, SETTINGS_CATEGORIES } from "./sectionIndex.ts";

/**
 * The launcher's search reads this index rather than the page, so a key in it
 * that does not resolve shows the operator a raw `field.whatever` where a
 * setting's name should be. That is what this guards; whether a row exists on
 * the page for every key is a rule the index's own comment states, not
 * something a unit test can see.
 */
describe("the settings index", () => {
  const catalog = en as Record<string, string>;

  it("names a category and a blurb that the English catalog answers", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(catalog[category.labelKey], category.labelKey).toBeTypeOf("string");
      expect(catalog[category.blurbKey], category.blurbKey).toBeTypeOf("string");
    }
  });

  it("names only rows the English catalog answers", () => {
    const missing = SETTINGS_CATEGORIES.flatMap((category) =>
      category.rowKeys.filter((key) => catalog[key] === undefined).map((key) => `${category.id}: ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it("reads the open category out of a settings URL, and nothing else", () => {
    expect(openCategory("/settings/engine")).toBe("engine");
    expect(openCategory("/settings/engine/")).toBe("engine");
    expect(openCategory("/settings")).toBeUndefined();
    // Not a category: the launcher, rather than an empty page under a name
    // nothing renders.
    expect(openCategory("/settings/nonsense")).toBeUndefined();
    expect(openCategory("/providers")).toBeUndefined();
  });
});
