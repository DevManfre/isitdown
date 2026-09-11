import type { CalendarDay } from "./types.ts";

/**
 * The year calendar's layout — roadmap 5.20.
 *
 * A year of days is drawn the way every heat calendar draws one: a column per
 * week, a row per weekday, oldest week on the left. The server sends a flat,
 * gap-filled list of days, so the only thing to work out here is where each day
 * sits — which is layout, not data, and therefore allowed to happen in the
 * browser (nothing about a percentage is being re-derived).
 *
 * Weeks start on Monday, and the first column is padded with `null` so the
 * oldest day lands on its real weekday. A `null` is a slot outside the window,
 * not an unmeasured day: an unmeasured day is a real cell with status
 * `unknown`, and the two must not paint the same.
 */

export const WEEKDAYS = 7;

/** Monday-first index for a `YYYY-MM-DD` day, read in UTC like every other day key. */
export function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % WEEKDAYS;
}

export interface CalendarGrid {
  /** Week columns, oldest first; each holds seven slots, `null` outside the window. */
  columns: (CalendarDay | null)[][];
  /** Where each calendar month begins, for the labels above the grid. */
  months: { month: string; column: number }[];
}

export function calendarGrid(cells: readonly CalendarDay[]): CalendarGrid {
  if (cells.length === 0) return { columns: [], months: [] };

  const columns: (CalendarDay | null)[][] = [];
  let current: (CalendarDay | null)[] = Array.from({ length: weekdayIndex(cells[0]!.day) }, () => null);

  for (const cell of cells) {
    if (current.length === WEEKDAYS) {
      columns.push(current);
      current = [];
    }
    current.push(cell);
  }
  // The last week is usually partial: padded to seven so every column is the
  // same height and the grid does not end in a ragged stack.
  while (current.length < WEEKDAYS) current.push(null);
  columns.push(current);

  const months: { month: string; column: number }[] = [];
  columns.forEach((column, index) => {
    for (const cell of column) {
      if (cell === null) continue;
      const month = cell.day.slice(0, 7);
      if (months.some((entry) => entry.month === month)) continue;
      // A month is labelled on the first column that carries any of its days,
      // so a month starting mid-week is not labelled a week late.
      months.push({ month, column: index });
    }
  });

  return { columns, months };
}
