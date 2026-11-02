import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPulses, pulse, pulseAttr, PULSE_MS, usePulses } from "./statusPulse.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearPulses();
  vi.useRealTimers();
});

describe("statusPulse", () => {
  it("flags a provider with its direction, and lets go after PULSE_MS", () => {
    const { result } = renderHook(() => usePulses());
    expect(pulseAttr(result.current, "github")).toEqual({});

    act(() => pulse("github", "worse"));
    expect(pulseAttr(result.current, "github")).toEqual({ "data-pulse": "worse" });
    expect(pulseAttr(result.current, "other")).toEqual({});

    act(() => vi.advanceTimersByTime(PULSE_MS));
    expect(pulseAttr(result.current, "github")).toEqual({});
  });

  it("restarts the clock when the same provider moves again", () => {
    const { result } = renderHook(() => usePulses());
    act(() => pulse("github", "worse"));
    act(() => vi.advanceTimersByTime(PULSE_MS - 100));
    act(() => pulse("github", "better"));
    act(() => vi.advanceTimersByTime(PULSE_MS - 100));
    expect(pulseAttr(result.current, "github")).toEqual({ "data-pulse": "better" });
    act(() => vi.advanceTimersByTime(100));
    expect(pulseAttr(result.current, "github")).toEqual({});
  });
});
