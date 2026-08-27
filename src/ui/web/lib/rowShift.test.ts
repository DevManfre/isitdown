import { describe, expect, it } from "vitest";
import { rowShifts } from "./rowShift.ts";

const tops = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("rowShifts", () => {
  it("offsets a row that moved up by the distance it moved", () => {
    const shifts = rowShifts(tops({ a: 0, b: 48, c: 96 }), tops({ a: 0, c: 48 }));
    // c sat at 96 and now sits at 48: it has to start 48px lower to look still.
    expect(shifts.get("c")).toBe(48);
  });

  it("leaves a row that did not move alone, so nothing is transitioned for free", () => {
    const shifts = rowShifts(tops({ a: 0, b: 48 }), tops({ a: 0, b: 48 }));
    expect(shifts.size).toBe(0);
  });

  it("offsets a row pushed down, not only one pulled up", () => {
    const shifts = rowShifts(tops({ a: 0, b: 48 }), tops({ a: 0, n: 48, b: 96 }));
    expect(shifts.get("b")).toBe(-48);
  });

  // A row that was not on the page a moment ago has nowhere to come back from;
  // its arrival is the entry animation's job, not this one's.
  it("ignores an arriving row", () => {
    const shifts = rowShifts(tops({ a: 0 }), tops({ a: 0, b: 48 }));
    expect(shifts.has("b")).toBe(false);
  });

  it("ignores a row that is gone: there is nothing left to move", () => {
    const shifts = rowShifts(tops({ a: 0, b: 48 }), tops({ a: 0 }));
    expect(shifts.has("b")).toBe(false);
  });

  it("has nothing to say about the first measurement", () => {
    expect(rowShifts(new Map(), tops({ a: 0, b: 48 })).size).toBe(0);
  });
});
