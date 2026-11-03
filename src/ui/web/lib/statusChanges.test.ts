import { describe, expect, it } from "vitest";
import { isBetter, isWorse, statusById, statusChanges } from "./statusChanges.ts";
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
      { id: "a", name: "A", status: "major_outage", was: "operational" },
      { id: "c", name: "C", status: "operational", was: "degraded" },
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
    expect(statusChanges(before, [suspected])).toEqual([{ id: "a", name: "A", status: "major_outage", was: "operational" }]);
  });
});

describe("isWorse and isBetter", () => {
  const move = (was: string, status: string) => ({ id: "a", name: "A", was, status });

  it("calls a move to a harsher measured status worse, and the way back better", () => {
    expect(isWorse(move("operational", "degraded"))).toBe(true);
    expect(isWorse(move("degraded", "major_outage"))).toBe(true);
    expect(isBetter(move("major_outage", "operational"))).toBe(true);
    expect(isWorse(move("major_outage", "operational"))).toBe(false);
    expect(isBetter(move("operational", "degraded"))).toBe(false);
  });

  it("never calls a move to or from unknown a worsening", () => {
    // A provider that has just started or stopped being measured did not get
    // worse; a tone for it would sound on every restart.
    expect(isWorse(move("unknown", "major_outage"))).toBe(false);
    expect(isWorse(move("operational", "unknown"))).toBe(false);
    expect(isBetter(move("major_outage", "unknown"))).toBe(false);
  });
});
