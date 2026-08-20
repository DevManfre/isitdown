import type { HistoricalIncident, NormalizedStatus } from "./types.ts";

/**
 * What an adapter needs to know about the service it is fetching. A generic
 * adapter (Statuspage) serves many providers, so the provider id travels with
 * the call rather than living on the adapter.
 */
export interface ServiceRef {
  id: string;
  name: string;
  baseUrl: string;
  /** Adapter-specific extras from config, e.g. a CSS selector for a scraper. */
  options?: Record<string, string> | undefined;
  /** Selected components; the adapter reports only these. Absent = none. */
  components?: { id: string; name: string }[] | undefined;
}

export interface FetchContext {
  timeoutMs: number;
}

export interface IncidentHistoryResult {
  incidents: HistoricalIncident[];
  /**
   * ISO timestamp the feed is complete back to. Null means the feed holds the
   * provider's full incident history (fewer entries than the feed cap).
   */
  coverageStart: string | null;
}

/** What the UI's picker shows before any component is selected. */
export interface ComponentPreview {
  id: string;
  name: string;
  /** Resolved group label (e.g. a Cloudflare region), null for ungrouped. */
  group: string | null;
  /** Statuspage's "featured" flag; a hint for the picker, nothing more. */
  showcase: boolean;
}

export interface Adapter {
  /** Registry key, e.g. "statuspage". */
  id: string;
  /**
   * Throws on a network error, a non-2xx response or an unparseable body so
   * the poller's retry and failure accounting can act. Degrades quietly on a
   * missing individual field instead.
   */
  fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus>;
  /**
   * Throws on a network error, a non-2xx response or an unparseable body so
   * the caller logs a warning and skips the provider. Degrades quietly on a
   * missing individual field instead. An adapter without this method simply has
   * no backfillable history.
   */
  fetchIncidentHistory?(service: ServiceRef, ctx: FetchContext): Promise<IncidentHistoryResult>;
  /**
   * Lists the components a provider exposes, for the selection picker. Optional:
   * an adapter without it simply offers no component monitoring. Throws like
   * `fetchStatus` does.
   */
  listComponents?(service: ServiceRef, ctx: FetchContext): Promise<ComponentPreview[]>;
}
