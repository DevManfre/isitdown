import { describe, expect, it } from "vitest";
import { stagger, STAGGER_CAP, STAGGER_STEP } from "./stagger.ts";

describe("stagger", () => {
  it("steps each item one step further than the last", () => {
    expect(stagger(0)).toBe("0ms");
    expect(stagger(1)).toBe(`${STAGGER_STEP}ms`);
    expect(stagger(3)).toBe(`${STAGGER_STEP * 3}ms`);
  });

  it("starts a list after the block it follows", () => {
    expect(stagger(0, { base: 90 })).toBe("90ms");
    expect(stagger(2, { base: 90, step: 20 })).toBe("130ms");
  });

  it("stops the tail of a long list from trailing the page", () => {
    expect(stagger(100)).toBe(`${STAGGER_CAP}ms`);
    expect(stagger(100, { base: 40, cap: 120 })).toBe("120ms");
  });

  it("caps on the total delay, base included", () => {
    expect(stagger(4, { base: 150, step: 20, cap: 180 })).toBe("180ms");
  });

  // dashboard-design-direction § Motion: a call site may ask for a quicker
  // cascade, never a slower one.
  it("never lets a call site step slower or end later than the design allows", () => {
    expect(stagger(1, { step: 70 })).toBe(`${STAGGER_STEP}ms`);
    expect(stagger(100, { base: 220, cap: 420 })).toBe(`${STAGGER_CAP}ms`);
  });
});
