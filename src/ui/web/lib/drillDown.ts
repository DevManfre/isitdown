import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * Where a number on the Overview leads — roadmap 4.3.
 *
 * A widget shows a figure, and the next question is always "which rows?". Each
 * of these builds the address of the view that answers it, with the filters
 * already applied and carried in the query string, so the link is a bookmark
 * too. `from=overview` is what makes the destination say how it was narrowed,
 * and only then: an operator who typed the same address knows already.
 */
export const FROM_PARAM = "from";
export const FROM_OVERVIEW = "overview";

export type IncidentState = "all" | "active" | "resolved";

const build = (path: string, params: Record<string, string | number | null | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "" && value !== 0) query.set(key, String(value));
  }
  query.set(FROM_PARAM, FROM_OVERVIEW);
  return `${path}?${query.toString()}`;
};

export const incidentsHref = (filter: { provider?: string | null; state?: IncidentState; days?: number } = {}): string =>
  build(ROUTE_PATHS.incidents, {
    provider: filter.provider,
    state: filter.state === "all" ? null : filter.state,
    days: filter.days,
  });

/** History with one provider's drawer open, over the window the number was counted in. */
export const historyHref = (filter: { provider?: string | null; days?: number } = {}): string =>
  build(ROUTE_PATHS.history, { provider: filter.provider, days: filter.days });

export const deliveryHref = (filter: { state?: "all" | "sent" | "failed" } = {}): string =>
  build(ROUTE_PATHS.deliveryLog, { state: filter.state });

/** A window a destination offers, or the nearest one at least as wide. */
export function snapWindow(days: number, windows: readonly number[]): number {
  return windows.find((window) => window !== 0 && days <= window) ?? windows[windows.length - 1] ?? days;
}

/** A positive whole number from the query string, or null for anything else. */
export function readDays(value: string | null): number | null {
  if (value === null) return null;
  const days = Number(value);
  return Number.isInteger(days) && days > 0 ? days : null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The two ends of a picked range from the query string — roadmap 4.11 — or null
 * unless both are real days and in order. A half-typed address is not a range.
 */
export function readRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (from === null || to === null || !DAY.test(from) || !DAY.test(to)) return null;
  if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) return null;
  return from <= to ? { from, to } : null;
}
