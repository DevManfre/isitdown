import { afterEach, describe, expect, it } from "vitest";
import fixtures from "./accent.fixtures.json";
import { accentReadability, accentTokens, applyAccent, contrastRatio, DARK_INK, LIGHT_INK, rgbToHex } from "./accent.ts";

// The colours the cases use live in a JSON file: the palette scan allows no hex
// literal in a .ts file outside tokens.css, and these are data, not styling.

afterEach(() => document.documentElement.removeAttribute("style"));

describe("accentTokens", () => {
  it("puts light text on a dark accent and dark text on a light one", () => {
    expect(accentTokens(fixtures.darkFills[0] as string)?.foreground).toBe("var(--on-accent-light)");
    expect(accentTokens(fixtures.lightFills[0] as string)?.foreground).toBe("var(--on-accent-dark)");
  });

  it("never picks the ink that reads worse on the fill", () => {
    // The mid-tones are where a fixed white-on-everything rule fails.
    for (const hex of fixtures.midTones) {
      const picked = accentTokens(hex)?.foreground === "var(--on-accent-light)" ? LIGHT_INK : DARK_INK;
      const other = picked === LIGHT_INK ? DARK_INK : LIGHT_INK;
      expect(contrastRatio(hex, rgbToHex(picked)), hex).toBeGreaterThanOrEqual(contrastRatio(hex, rgbToHex(other)));
    }
  });

  it("refuses anything that is not #rrggbb", () => {
    for (const value of fixtures.notAccents) expect(accentTokens(value), value).toBeNull();
  });
});

describe("applyAccent", () => {
  it("writes the four accent properties and takes them away again", () => {
    applyAccent(fixtures.picked);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--color-accent")).toBe(fixtures.picked);
    expect(style.getPropertyValue("--status-accent")).toBe(fixtures.picked);
    expect(style.getPropertyValue("--primary-foreground")).not.toBe("");
    expect(style.getPropertyValue("--primary-hover")).toContain(fixtures.picked);

    applyAccent("");
    for (const property of ["--color-accent", "--status-accent", "--primary-foreground", "--primary-hover"]) {
      expect(style.getPropertyValue(property), property).toBe("");
    }
  });

  it("never touches a status colour", () => {
    applyAccent(fixtures.picked);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--status-operational")).toBe("");
    expect(style.getPropertyValue("--status-major-outage")).toBe("");
  });
});

describe("accentReadability", () => {
  it("says how hard an accent is to see on a ground, and nothing for a value it cannot read", () => {
    expect(accentReadability(fixtures.black, fixtures.white)).toBeCloseTo(21, 0);
    expect(accentReadability(fixtures.nearWhite, fixtures.white)).toBeLessThan(1.2);
    expect(accentReadability("nope", fixtures.white)).toBeNull();
  });
});
