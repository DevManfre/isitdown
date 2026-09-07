import { describe, expect, it } from "vitest";
import { providerFixture } from "@/test/harness.tsx";
import { faviconDataUri, fleetStatus, STATUS_FALLBACK_FILL, statusFill } from "./documentStatus.ts";
import type { OverallStatus } from "./types.ts";

const provider = (overallStatus: OverallStatus, over: { id?: string; enabled?: boolean } = {}) => ({
  ...providerFixture(),
  id: over.id ?? overallStatus,
  overallStatus,
  enabled: over.enabled ?? true,
});

describe("fleetStatus", () => {
  it("is calm and counts nothing while every provider is operational", () => {
    expect(fleetStatus([provider("operational"), provider("operational", { id: "b" })])).toEqual({
      worst: "operational",
      affected: 0,
    });
  });

  it("reports the worst status and how many providers are in trouble", () => {
    const fleet = fleetStatus([
      provider("operational"),
      provider("degraded"),
      provider("major_outage"),
      provider("partial_outage"),
    ]);

    expect(fleet).toEqual({ worst: "major_outage", affected: 3 });
  });

  it("does not treat a provider that has never been read as trouble", () => {
    // A fresh instance whose first cycle has not landed reads `unknown`
    // everywhere, and must not open with an alarming tab.
    expect(fleetStatus([provider("unknown"), provider("unknown", { id: "b" })])).toEqual({
      worst: "operational",
      affected: 0,
    });
  });

  it("ignores a disabled provider: it is off the dashboard entirely", () => {
    expect(fleetStatus([provider("major_outage", { enabled: false }), provider("operational")])).toEqual({
      worst: "operational",
      affected: 0,
    });
  });

  it("says nothing is wrong with an empty fleet", () => {
    expect(fleetStatus([])).toEqual({ worst: "operational", affected: 0 });
  });
});

describe("faviconDataUri", () => {
  it("draws the brand mark with a dot in the status colour", () => {
    const svg = decodeURIComponent(faviconDataUri("major_outage", STATUS_FALLBACK_FILL.major_outage));

    expect(svg).toContain("<circle");
    expect(svg).toContain(`fill="${STATUS_FALLBACK_FILL.major_outage}"`);
    // The mark's own geometry, so the tab still reads as this product.
    expect(svg).toContain("M2 12h4l2.5-6 3.5 12 3-8 2 2h5");
  });

  it("is a data URI a <link rel=icon> can be pointed at", () => {
    expect(faviconDataUri("degraded")).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  });

  it("falls back to a literal colour where the token cannot be read", () => {
    // No stylesheet of ours reaches the browser chrome, and none is loaded
    // under the test DOM either — the dot still has to have a colour.
    expect(statusFill("major_outage")).toBe(STATUS_FALLBACK_FILL.major_outage);
    expect(decodeURIComponent(faviconDataUri("degraded"))).toContain(
      `fill="${STATUS_FALLBACK_FILL.degraded}"`,
    );
  });
});
