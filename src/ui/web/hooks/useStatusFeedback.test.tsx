import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerFixture } from "@/test/harness.tsx";
import { resetSoundCache, writeSound } from "@/lib/sound.ts";
import { clearPulses, pulseAttr, usePulses } from "@/lib/statusPulse.ts";
import type { OverallStatus, StatusResponse } from "@/lib/types.ts";
import { useStatusFeedback } from "./useStatusFeedback.ts";

const played = vi.fn();
vi.mock("@/lib/sound.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sound.ts")>()),
  playAlert: (...args: unknown[]) => played(...args),
}));

const fleet = (statuses: Record<string, OverallStatus>): StatusResponse => ({
  providers: Object.entries(statuses).map(([id, overallStatus]) => ({ ...providerFixture(), id, name: id, overallStatus, enabled: true })),
  pollIntervalMinutes: 3,
  lastPollAt: null,
  nextPollAt: null,
});

function setup(first: StatusResponse) {
  return renderHook(
    ({ data }: { data: StatusResponse }) => {
      useStatusFeedback(data);
      return usePulses();
    },
    { initialProps: { data: first } },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetSoundCache();
  played.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  clearPulses();
  vi.useRealTimers();
});

describe("useStatusFeedback", () => {
  it("treats the first read as a baseline: no pulse, no sound", () => {
    writeSound({ enabled: true, volume: 50, minSeverity: "degraded" });
    const { result } = setup(fleet({ github: "major_outage" }));
    expect(pulseAttr(result.current, "github")).toEqual({});
    expect(played).not.toHaveBeenCalled();
  });

  it("pulses the tile that got worse, and plays nothing while the sound is off", () => {
    const { result, rerender } = setup(fleet({ github: "operational", slack: "operational" }));
    rerender({ data: fleet({ github: "major_outage", slack: "operational" }) });
    expect(pulseAttr(result.current, "github")).toEqual({ "data-pulse": "worse" });
    expect(pulseAttr(result.current, "slack")).toEqual({});
    expect(played).not.toHaveBeenCalled();
  });

  it("pulses a recovery as better and never sounds for it", () => {
    writeSound({ enabled: true, volume: 50, minSeverity: "degraded" });
    const { result, rerender } = setup(fleet({ github: "major_outage" }));
    rerender({ data: fleet({ github: "operational" }) });
    expect(pulseAttr(result.current, "github")).toEqual({ "data-pulse": "better" });
    expect(played).not.toHaveBeenCalled();
  });

  it("plays one tone for the worst change in a read, not one per provider", () => {
    writeSound({ enabled: true, volume: 50, minSeverity: "degraded" });
    const { rerender } = setup(fleet({ a: "operational", b: "operational", c: "operational" }));
    act(() => rerender({ data: fleet({ a: "degraded", b: "major_outage", c: "partial_outage" }) }));
    expect(played).toHaveBeenCalledTimes(1);
    expect(played.mock.calls[0]?.[1]).toBe(3);
  });

  it("stays quiet for a worsening milder than the chosen severity", () => {
    writeSound({ enabled: true, volume: 50, minSeverity: "major_outage" });
    const { rerender } = setup(fleet({ a: "operational" }));
    rerender({ data: fleet({ a: "degraded" }) });
    expect(played).not.toHaveBeenCalled();
  });

  it("does not take a provider that was never measured going down as a worsening", () => {
    writeSound({ enabled: true, volume: 50, minSeverity: "degraded" });
    const { result, rerender } = setup(fleet({ a: "unknown" }));
    rerender({ data: fleet({ a: "major_outage" }) });
    expect(pulseAttr(result.current, "a")).toEqual({});
    expect(played).not.toHaveBeenCalled();
  });
});
