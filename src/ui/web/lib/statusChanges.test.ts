import { describe, expect, it } from "vitest";
import { statusById, statusChanges } from "./statusChanges.ts";
import { providerFixture } from "@/test/harness.tsx";
import type { OverallStatus, ProviderStatus } from "./types.ts";

const provider = (id: string, overallStatus: OverallStatus, over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  ...providerFixture(),
  id,
  name: id.toUpperCase(),
  overallStatus,
  enabled: true,
  ...over,
});

describe("statusChanges", () => {
  it("names the providers whose status moved, and only those", () => {
    const before = statusById([provider("a", "operational"), provider("b", "operational"), provider("c", "degraded")]);
    const changes = statusChanges(before, [
      provider("a", "major_outage"),
      provider("b", "operational"),
      provider("c", "operational"),
    ]);
    expect(changes).toEqual([
      { id: "a", name: "A", status: "major_outage" },
      { id: "c", name: "C", status: "operational" },
    ]);
  });

  it("says nothing for a provider it has not seen before", () => {
    const before = statusById([provider("a", "operational")]);
    expect(statusChanges(before, [provider("a", "operational"), provider("new", "major_outage")])).toEqual([]);
  });

  it("says nothing for a provider that has been switched off", () => {
    const before = statusById([provider("a", "operational")]);
    expect(statusChanges(before, [provider("a", "major_outage", { enabled: false })])).toEqual([]);
  });

  it("reads the status the dashboard shows, not the one the page declares", () => {
    // A suspicion is what the dot draws (roadmap 1.3), so it is what is said.
    const before = statusById([provider("a", "operational")]);
    const suspected = provider("a", "operational", {
      suspected: { status: "major_outage" } as NonNullable<ProviderStatus["suspected"]>,
    });
    expect(statusChanges(before, [suspected])).toEqual([{ id: "a", name: "A", status: "major_outage" }]);
  });
});
