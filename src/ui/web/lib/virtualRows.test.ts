import { describe, expect, it } from "vitest";
import { rowSpan } from "./virtualRows.ts";

const rows = (count: number, height = 50): number[] => Array(count).fill(height);

describe("rowSpan", () => {
  it("mounts the viewport's rows plus the overscan, and stands in for the rest", () => {
    const span = rowSpan(rows(100), 0, 500, 2);
    expect(span).toEqual({ start: 0, end: 12, before: 0, after: 88 * 50 });
  });

  it("skips what has scrolled past the top", () => {
    // 1000px scrolled: rows 0..19 are above the viewport.
    const span = rowSpan(rows(100), -1000, 500, 0);
    // Row 19 ends exactly at the viewport's edge, so it is still mounted.
    expect(span.start).toBe(19);
    expect(span.end).toBe(30);
    expect(span.before).toBe(950);
    expect(span.before + (span.end - span.start) * 50 + span.after).toBe(5000);
  });

  it("honours a row an open panel made taller", () => {
    const heights = rows(10);
    heights[0] = 400;
    const span = rowSpan(heights, -300, 200, 0);
    expect(span.start).toBe(0);
    expect(span.end).toBe(3);
  });

  it("keeps the table's own height whatever is mounted", () => {
    const heights = [40, 80, 60, 120, 50];
    const span = rowSpan(heights, -50, 100, 0);
    const mounted = heights.slice(span.start, span.end).reduce((a, b) => a + b, 0);
    expect(span.before + mounted + span.after).toBe(350);
  });

  it("handles an empty table", () => {
    expect(rowSpan([], 0, 500, 3)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
