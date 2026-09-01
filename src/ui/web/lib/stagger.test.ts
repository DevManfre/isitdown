import { describe, expect, it } from "vitest";
import { stagger, STAGGER_CAP, STAGGER_STEP } from "./stagger.ts";

describe("stagger", () => {
  it("steps each item one step further than the last", () => {
    expect(stagger(0)).toBe("0ms");
    expect(stagger(1)).toBe(`${STAGGER_STEP}ms`);
    expect(stagger(3)).toBe(`${STAGGER_STEP * 3}ms`);
  });

  it("starts a list after the block it follows", () => {
    expect(stagger(0, { base: 200 })).toBe("200ms");
    expect(stagger(2, { base: 200, step: 32 })).toBe("264ms");
  });

  it("stops the tail of a long list from trailing the page", () => {
    expect(stagger(100)).toBe(`${STAGGER_CAP}ms`);
    expect(stagger(100, { base: 200, cap: 400 })).toBe("400ms");
  });

  it("caps on the total delay, base included", () => {
    expect(stagger(4, { base: 300, step: 100, cap: 500 })).toBe("500ms");
  });
});
