import { describe, expect, it } from "vitest";
import { dropIndex, type Slot } from "./gridDrag.ts";

// A 6-column grid, 600px wide: one full-width row, then two halves, then a third.
const slots: Slot[] = [
  { left: 0, top: 0, width: 600, height: 100 },
  { left: 0, top: 116, width: 292, height: 80 },
  { left: 308, top: 116, width: 292, height: 120 },
  { left: 0, top: 252, width: 192, height: 60 },
];

describe("dropIndex", () => {
  it("is the slot under the pointer", () => {
    expect(dropIndex(slots, { x: 400, y: 150 }, 0)).toBe(2);
    expect(dropIndex(slots, { x: 50, y: 270 }, 0)).toBe(3);
  });

  it("moves sideways as well as down — a half can trade places with its neighbour", () => {
    expect(dropIndex(slots, { x: 100, y: 150 }, 2)).toBe(1);
  });

  it("never answers the dragged widget's own slot, which is always under the pointer", () => {
    expect(dropIndex(slots, { x: 10, y: 10 }, 0)).toBe(0);
  });

  it("keeps the current index over a gap or outside the grid, so a drag does not flicker between slots", () => {
    expect(dropIndex(slots, { x: 300, y: 150 }, 1)).toBe(1);
    expect(dropIndex(slots, { x: 900, y: 900 }, 2)).toBe(2);
  });
});
