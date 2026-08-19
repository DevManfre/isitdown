import type { NormalizedStatus } from "./types.ts";

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
}

export interface FetchContext {
  timeoutMs: number;
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
}
