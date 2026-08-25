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
