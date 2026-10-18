import { describe, expect, it } from "vitest";
import { isApplePlatform } from "./shortcut.ts";

describe("isApplePlatform", () => {
  it("reads userAgentData's platform first", () => {
    expect(isApplePlatform({ platform: "Win32", userAgentData: { platform: "macOS" } })).toBe(true);
  });

  it("falls back to navigator.platform", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "iPhone" })).toBe(true);
  });

  it("is false on Windows and Linux", () => {
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64", userAgentData: { platform: "Linux" } })).toBe(false);
  });
});
