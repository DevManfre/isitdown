import { describe, expect, it } from "vitest";
import { faviconCandidates } from "./favicon.ts";

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
