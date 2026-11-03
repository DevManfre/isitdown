import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUND, isLoudEnough, parseSound, playAlert, readSound, resetSoundCache, writeSound } from "./sound.ts";

beforeEach(() => {
  window.localStorage.clear();
  resetSoundCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("parseSound", () => {
  it("is off and mild when nothing was stored", () => {
    expect(parseSound(null)).toEqual(DEFAULT_SOUND);
    expect(DEFAULT_SOUND.enabled).toBe(false);
  });

  it("mends a damaged value field by field and never turns the sound on by accident", () => {
    expect(parseSound("not json")).toEqual(DEFAULT_SOUND);
    expect(parseSound("null")).toEqual(DEFAULT_SOUND);
    expect(parseSound(JSON.stringify({ enabled: "yes", volume: 999, minSeverity: "loud" }))).toEqual({
      enabled: false,
      volume: 100,
      minSeverity: DEFAULT_SOUND.minSeverity,
    });
    expect(parseSound(JSON.stringify({ enabled: true, volume: -5, minSeverity: "major_outage" }))).toEqual({
      enabled: true,
      volume: 0,
      minSeverity: "major_outage",
    });
  });
});

describe("isLoudEnough", () => {
  const on = { enabled: true, volume: 50, minSeverity: "partial_outage" as const };

  it("makes no sound while off or muted, whatever happened", () => {
    expect(isLoudEnough({ ...on, enabled: false }, 3)).toBe(false);
    expect(isLoudEnough({ ...on, volume: 0 }, 3)).toBe(false);
  });

  it("sounds from the chosen severity upward and not below it", () => {
    expect(isLoudEnough(on, 1)).toBe(false);
    expect(isLoudEnough(on, 2)).toBe(true);
    expect(isLoudEnough(on, 3)).toBe(true);
    expect(isLoudEnough({ ...on, minSeverity: "degraded" }, 1)).toBe(true);
    expect(isLoudEnough({ ...on, minSeverity: "major_outage" }, 2)).toBe(false);
  });
});

describe("storage", () => {
  it("remembers a write across a fresh read", () => {
    writeSound({ enabled: true, volume: 25, minSeverity: "degraded" });
    resetSoundCache();
    expect(readSound()).toEqual({ enabled: true, volume: 25, minSeverity: "degraded" });
  });

  it("still holds the choice for this tab when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeSound({ enabled: true, volume: 50, minSeverity: "degraded" })).not.toThrow();
    expect(readSound().enabled).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("playAlert", () => {
  it("reports silence, rather than throwing, where there is no audio at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(await playAlert({ enabled: true, volume: 50, minSeverity: "degraded" }, 3)).toBe(false);
  });
});
