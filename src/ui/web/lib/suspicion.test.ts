import { describe, expect, it } from "vitest";
import { providerFixture } from "@/test/harness.tsx";
import { isOffLine, shownStatus, suspectedOf } from "./suspicion.ts";
import type { Suspicion } from "./types.ts";

const suspicion: Suspicion = { status: "major_outage", probeId: "github-api", since: "2026-10-06T20:06:00Z" };

describe("shownStatus", () => {
  it("draws the page's own word plainly when nothing is suspected", () => {
    expect(shownStatus(providerFixture({ overallStatus: "degraded" }))).toEqual({
      status: "degraded",
      hatched: false,
      suspicion: null,
    });
  });

  it("draws a declared provider's suspicion in the measured colour, hatched", () => {
    const shown = shownStatus(providerFixture({ overallStatus: "operational", suspected: suspicion }));
    expect(shown).toEqual({ status: "major_outage", hatched: true, suspicion });
  });

  it("draws an observed provider's suspicion solid, since the probe is the record", () => {
    const shown = shownStatus(providerFixture({ overallStatus: "operational", authority: "observed", suspected: suspicion }));
    expect(shown.status).toBe("major_outage");
    expect(shown.hatched).toBe(false);
  });

  it("reads a server that sends no suspected field as nothing suspected", () => {
    const { suspected: _omitted, ...older } = providerFixture({ overallStatus: "operational" });
    expect(shownStatus(older).hatched).toBe(false);
  });
});

describe("isOffLine and suspectedOf", () => {
  const declared = providerFixture({ id: "cloudflare", overallStatus: "operational", suspected: suspicion });
  const observed = providerFixture({ id: "probe-led", overallStatus: "operational", authority: "observed", suspected: suspicion });
  const down = providerFixture({ id: "anthropic", overallStatus: "major_outage" });
  const unread = providerFixture({ id: "x", overallStatus: "unknown" });

  it("keeps a hatched suspicion out of the off-the-line count and in its own list", () => {
    expect(isOffLine(declared)).toBe(false);
    expect(suspectedOf([declared, observed, down])).toEqual([declared]);
  });

  it("counts an observed suspicion and a declared outage as off the line, an unread provider as neither", () => {
    expect(isOffLine(observed)).toBe(true);
    expect(isOffLine(down)).toBe(true);
    expect(isOffLine(unread)).toBe(false);
  });
});
