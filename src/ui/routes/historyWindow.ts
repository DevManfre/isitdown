/** The only windows the dashboard offers, so the only ones the API serves. */
export const ALLOWED_DAYS = [7, 30, 90] as const;
export const DEFAULT_DAYS = 90;

/**
 * The year calendar's own window — roadmap 5.20. Not a member of `ALLOWED_DAYS`:
 * the bar rows and the export offer 7/30/90 because that is what they can draw
 * legibly, and adding 365 there would put a fourth pill on the range control
 * that squeezes a year into ninety bars' worth of width.
 */
export const CALENDAR_DAYS = 365;

/**
 * Parsed by hand rather than through a coercing schema: a bad value has to be
 * told which windows exist, and a coercion failure would answer "expected
 * number, received nan" instead.
 *
 * Shared by `/history` and `/export/history.*` so the export cannot end up
 * offering a window the charts do not (roadmap 4.6).
 */
export function parseDays(raw: unknown): number | null {
  if (raw === undefined) return DEFAULT_DAYS;
  const value = Number(raw);
  return (ALLOWED_DAYS as readonly number[]).includes(value) ? value : null;
}

/**
 * The widest arbitrary range the API will answer (roadmap 5.5). A year and a
 * day: the calendar view already covers a year, and a range wider than the
 * default retention would be mostly empty cells presented as history.
 */
export const MAX_RANGE_DAYS = 366;

/** A day key, `YYYY-MM-DD`, and only that — never a parseable near-miss. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface HistoryWindow {
  /** How many days the window spans, ends included. */
  days: number;
  /**
   * The last day in it, `YYYY-MM-DD`. Absent means "up to today", which is what
   * every window was before an arbitrary range could be asked for.
   */
  endDay?: string | undefined;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

/**
 * The window a `/history` request is asking for: either one of the three fixed
 * ones, or an arbitrary `from`/`to` pair (roadmap 5.5).
 *
 * Returns the reason as a string rather than null, because every way this can
 * fail is something the caller has to be told — "days must be one of 7, 30, 90"
 * was already that, and "from must be YYYY-MM-DD" is no less actionable.
 *
 * `from` and `to` travel together: one of them alone is a half-written request,
 * and guessing the other end (today? the start of history?) would answer a
 * question nobody asked.
 */
export function parseWindow(query: {
  days?: unknown;
  from?: unknown;
  to?: unknown;
}): HistoryWindow | { error: string } {
  const { from, to } = query;
  if (from === undefined && to === undefined) {
    const days = parseDays(query.days ?? undefined);
    return days === null ? { error: `days must be one of ${ALLOWED_DAYS.join(", ")}` } : { days };
  }
  if (typeof from !== "string" || typeof to !== "string") {
    return { error: "from and to must be given together, as YYYY-MM-DD" };
  }
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) {
    return { error: "from and to must be YYYY-MM-DD" };
  }
  const start = dayStart(from);
  const end = dayStart(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "from and to must be real dates" };
  if (end < start) return { error: "to must not be before from" };

  const days = Math.round((end - start) / MS_PER_DAY) + 1;
  if (days > MAX_RANGE_DAYS) return { error: `a range may span at most ${MAX_RANGE_DAYS} days` };
  return { days, endDay: to };
}
