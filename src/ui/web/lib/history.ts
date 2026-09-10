import type { HistorySummary, ProviderHistory } from "./types.ts";

/**
 * `getHistory` returns the same undiscriminated union whether or not a
 * provider was requested. Every call site here omits the provider, so the
 * result is always a `HistorySummary` — but the declared return type is
 * still that union either way. `"providers" in value` narrows without a
 * cast: only `HistorySummary` carries that field.
 *
 * Shared by Overview and Providers so the narrowing logic exists in one
 * place instead of two verbatim copies.
 */
export function summaryProviders(value: HistorySummary | ProviderHistory | undefined): ProviderHistory[] {
  return value !== undefined && "providers" in value ? value.providers : [];
}

/**
 * The provider figure matching the requested window.
 *
 * The same rule the server applies in `uptimeKey` — mirrored rather than
 * recomputed, because the three numbers themselves still come from the server.
 * The list shows one of them, not all three: five unlabelled monospace numbers
 * in a row is a table nobody can read.
 */
export function uptimeForRange(provider: ProviderHistory, days: number): number {
  return days <= 7 ? provider.uptime7 : days <= 30 ? provider.uptime30 : provider.uptime90;
}

/** One day, as the two providers being compared each measured it. */
export interface ComparedDay {
  day: string;
  left: number | null;
  right: number | null;
}

/**
 * Two providers' daily series on shared rows, so one chart can overlay them
 * (roadmap 5.7).
 *
 * A day only one of them measured keeps the other `null` rather than 0: a
 * provider that was not being watched did not have a full outage, and the
 * chart draws a gap there for the same reason `UptimeTrendChart` refuses to
 * connect across one.
 *
 * The union of both sets of days rather than the intersection, because a
 * provider added last week must still be comparable against one watched all
 * quarter — it just has nothing to say about the days before it arrived.
 */
export function alignSeries(left: ProviderHistory, right: ProviderHistory): ComparedDay[] {
  const rows = new Map<string, ComparedDay>();
  const put = (day: string): ComparedDay => {
    const existing = rows.get(day) ?? { day, left: null, right: null };
    rows.set(day, existing);
    return existing;
  };

  for (const entry of left.dailySeries) put(entry.day).left = entry.uptime;
  for (const entry of right.dailySeries) put(entry.day).right = entry.uptime;

  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}
