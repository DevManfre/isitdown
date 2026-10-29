import { describe, expect, it } from "vitest";
import { readRange } from "./drillDown.ts";

describe("readRange", () => {
  it("reads two real days in order", () => {
    expect(readRange("2026-10-01", "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(readRange("2026-10-01", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("refuses a half-typed, malformed, impossible or reversed pair", () => {
    expect(readRange(null, "2026-10-07")).toBeNull();
    expect(readRange("2026-10-01", null)).toBeNull();
    expect(readRange("yesterday", "2026-10-07")).toBeNull();
    expect(readRange("2026-13-45", "2026-14-01")).toBeNull();
    expect(readRange("2026-10-07", "2026-10-01")).toBeNull();
  });
});
