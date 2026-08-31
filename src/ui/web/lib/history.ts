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
