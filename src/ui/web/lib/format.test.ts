import { afterEach, describe, expect, it } from "vitest";
import { effectiveTimeZone, setTimeZone, timeZone } from "./timeZone.ts";
import {
  formatDay, formatDuration, formatNumber, formatPercent, formatRelative, formatTime, notificationHeadline,
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

describe("the time zone preference", () => {
  afterEach(() => {
    setTimeZone("auto");
  });

  it("renders clock times in the chosen zone rather than the browser's", () => {
    const noonUtc = "2026-09-01T12:00:00.000Z";

    setTimeZone("UTC");
    const utc = formatTime("en", noonUtc);
    setTimeZone("Asia/Tokyo");
    const tokyo = formatTime("en", noonUtc);

    expect(utc).toMatch(/12/);
    // Tokyo is UTC+9 all year, so noon UTC is 21:00 there.
    expect(tokyo).toMatch(/09|9/);
    expect(tokyo).not.toBe(utc);
  });

  it("keeps daily bars on UTC days, whatever zone the operator picked", () => {
    // The bucket is a UTC day: labelling its midnight in another zone would
    // name the bar after the day beside the data it holds.
    setTimeZone("Pacific/Auckland");
    const auckland = formatDay("en", "2026-09-01");
    setTimeZone("America/Los_Angeles");

    expect(auckland).toBe(formatDay("en", "2026-09-01"));
    expect(auckland).toMatch(/1/);
  });

  it("falls back to the browser's zone when the stored name is unusable", () => {
    setTimeZone("Mars/Olympus");

    expect(timeZone()).toBeUndefined();
    expect(effectiveTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("treats auto as no choice at all", () => {
    setTimeZone("UTC");
    setTimeZone("auto");

    expect(timeZone()).toBeUndefined();
  });
});
