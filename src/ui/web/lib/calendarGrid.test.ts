import { describe, expect, it } from "vitest";
import { calendarGrid, weekdayIndex } from "./calendarGrid.ts";
import type { CalendarDay } from "./types.ts";

const DAY_MS = 24 * 3600 * 1000;

/** `count` consecutive days ending on `last`, all operational — the server's own shape. */
function days(last: string, count: number): CalendarDay[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return Array.from({ length: count }, (_unused, index) => ({
    day: new Date(end - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10),
    status: "operational" as const,
    uptime: 100,
  }));
}

describe("weekdayIndex", () => {
  it("is Monday-first, and reads the day in UTC", () => {
    // 2026-09-07 is a Monday.
    expect(weekdayIndex("2026-09-07")).toBe(0);
    expect(weekdayIndex("2026-09-13")).toBe(6);
  });
});

describe("calendarGrid", () => {
  it("puts a week in each column, seven slots tall", () => {
    const grid = calendarGrid(days("2026-09-13", 14));

    expect(grid.columns).toHaveLength(2);
    expect(grid.columns.every((column) => column.length === 7)).toBe(true);
  });

  it("pads the first column so the oldest day lands on its own weekday", () => {
    // 2026-09-10 is a Thursday: three empty slots before it.
    const grid = calendarGrid(days("2026-09-10", 1));

    expect(grid.columns[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(grid.columns[0]?.[3]?.day).toBe("2026-09-10");
  });

  it("pads the last column too, so the grid does not end ragged", () => {
    const grid = calendarGrid(days("2026-09-09", 10));

    expect(grid.columns.at(-1)).toHaveLength(7);
    expect(grid.columns.at(-1)?.at(-1)).toBeNull();
  });

  it("keeps every day, in order, across a full year", () => {
    const cells = days("2026-09-10", 365);

    const grid = calendarGrid(cells);
    const flat = grid.columns.flat().filter((cell) => cell !== null);

    expect(flat).toHaveLength(365);
    expect(flat.map((cell) => cell?.day)).toEqual(cells.map((cell) => cell.day));
  });

  it("labels each month on the first column that carries any of its days", () => {
    // A month whose 1st is mid-week must not be labelled a week late:
    // 2026-08-01 is a Saturday, so it sits in the column that starts 2026-07-27.
    const grid = calendarGrid(days("2026-08-05", 40));
    const august = grid.months.find((entry) => entry.month === "2026-08");
    const columnOfFirst = grid.columns.findIndex((column) =>
      column.some((cell) => cell?.day === "2026-08-01"),
    );

    expect(august?.column).toBe(columnOfFirst);
    expect(grid.months.map((entry) => entry.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("answers an empty window with an empty grid rather than one blank column", () => {
    expect(calendarGrid([])).toEqual({ columns: [], months: [] });
  });
});
