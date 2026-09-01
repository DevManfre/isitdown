import { describe, expect, it } from "vitest";
import {
  formatDay, formatDuration, formatNumber, formatPercent, formatRelative, notificationHeadline,
} from "./format.ts";

describe("locale-aware formatting", () => {
  it("formats a number with the locale's own separators", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    // Node's ICU (78.3) uses a "min2" grouping strategy for it: a 4-digit
    // integer part doesn't clear the threshold, so no grouping separator
    // appears here even though it would for a 5-digit number.
    expect(formatNumber("it", 1234.5)).toBe("1234,5");
  });

  it("always shows two decimals on a percentage", () => {
    expect(formatPercent("en", 99.9)).toBe("99.90%");
  });

  it("formats a calendar day in the locale's month order", () => {
    expect(formatDay("en", "2026-03-04")).toMatch(/Mar/);
    expect(formatDay("it", "2026-03-04")).toMatch(/mar/);
  });

  it("steps a duration up out of minutes", () => {
    expect(formatDuration("en", 45)).toMatch(/45/);
    expect(formatDuration("en", 120)).toMatch(/2/);
    expect(formatDuration("en", 2880)).toMatch(/2/);
  });

  it("renders a past instant as relative time", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(formatRelative("en", twoHoursAgo)).toMatch(/2 hours ago/);
  });
});

describe("notificationHeadline", () => {
  it("drops the notifier's leading status emoji", () => {
    expect(notificationHeadline("🟢 Anthropic — operational")).toBe("Anthropic — operational");
  });

  it("keeps a headline that starts with a word, and only the first line", () => {
    expect(notificationHeadline("Anthropic degraded\nsecond line")).toBe("Anthropic degraded");
  });
});
