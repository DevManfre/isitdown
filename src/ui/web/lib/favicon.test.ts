import { describe, expect, it } from "vitest";
import { faviconCandidates, trimToLatest } from "./favicon.ts";

describe("faviconCandidates", () => {
  it("offers the origin's own icon first, then a fallback service", () => {
    expect(faviconCandidates("https://www.githubstatus.com/api")).toEqual([
      "https://www.githubstatus.com/favicon.ico",
      "https://icons.duckduckgo.com/ip3/www.githubstatus.com.ico",
    ]);
  });

  it("returns nothing for a url it cannot parse", () => {
    expect(faviconCandidates("not a url")).toEqual([]);
  });
});

describe("trimToLatest", () => {
  it("keeps the newest entries of a newest-first list", () => {
    expect(trimToLatest([5, 4, 3, 2, 1], 3)).toEqual([5, 4, 3]);
  });

  it("returns the whole list when it is shorter than the window", () => {
    expect(trimToLatest([1], 3)).toEqual([1]);
  });
});
