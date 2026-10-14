import { describe, expect, it } from "vitest";
import { sharedFailure, type SharedFailureInput } from "./sharedFailure.ts";

const p = (id: string, overallStatus: SharedFailureInput["overallStatus"], enabled = true): SharedFailureInput => ({
  id,
  name: id.toUpperCase(),
  enabled,
  overallStatus,
});
const deps = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

describe("sharedFailure", () => {
  it("names the upstream two bad providers declare", () => {
    const found = sharedFailure(
      [p("vercel", "degraded"), p("npm", "major_outage"), p("figma", "operational")],
      deps({ vercel: ["cloudflare"], npm: ["cloudflare"], figma: ["cloudflare"] }),
    );
    expect(found?.cause).toBe("cloudflare");
    expect(found?.dependents.map((d) => d.id)).toEqual(["npm", "vercel"]);
  });

  it("stays silent below two bad dependents", () => {
    expect(
      sharedFailure([p("vercel", "degraded"), p("npm", "operational")], deps({ vercel: ["aws"], npm: ["aws"] })),
    ).toBeNull();
  });

  it("does not count unknown or disabled providers as evidence", () => {
    expect(
      sharedFailure(
        [p("a", "unknown"), p("b", "major_outage", false), p("c", "degraded")],
        deps({ a: ["x"], b: ["x"], c: ["x"] }),
      ),
    ).toBeNull();
  });

  it("breaks a tie toward the id that sorts first", () => {
    const found = sharedFailure(
      [p("a", "degraded"), p("b", "degraded")],
      deps({ a: ["zeta", "alpha"], b: ["alpha", "zeta"] }),
    );
    expect(found?.cause).toBe("alpha");
  });

  it("ignores a provider declaring itself", () => {
    expect(sharedFailure([p("a", "degraded"), p("b", "degraded")], deps({ a: ["a"], b: ["a"] }))).toBeNull();
  });
});
