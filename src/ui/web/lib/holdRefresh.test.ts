import { describe, expect, it } from "vitest";
import { shouldHoldRefresh } from "./holdRefresh.ts";

const page = (over: Partial<Parameters<typeof shouldHoldRefresh>[0]> = {}) => ({
  hidden: false,
  dialogOpen: false,
  editing: false,
  ...over,
});

describe("shouldHoldRefresh", () => {
  it("lets an idle visible page refresh", () => {
    expect(shouldHoldRefresh(page())).toBe(false);
  });

  it("holds a hidden tab: it has nothing to show", () => {
    expect(shouldHoldRefresh(page({ hidden: true }))).toBe(true);
  });

  it("holds under an open dialog", () => {
    expect(shouldHoldRefresh(page({ dialogOpen: true }))).toBe(true);
  });

  it("holds while a field is being edited", () => {
    expect(shouldHoldRefresh(page({ editing: true }))).toBe(true);
  });
});
