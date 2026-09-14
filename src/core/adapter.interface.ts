import type { StatusPageRead } from "./http.ts";
import type { HistoricalIncident, NormalizedStatus, OverallStatus } from "./types.ts";

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
  /**
   * Narrows the whole provider to the selection: an incident attributed only to
   * unselected components is dropped, and the overall status is folded from the
   * selected components instead of the provider's page-wide indicator. Ignored
   * while nothing is selected, so ticking it alone can never silence a provider.
   */
  scopeToComponents?: boolean | undefined;
}

/**
 * Something the adapter learned that the reading itself has nowhere to carry.
 *
 * A `NormalizedStatus` is a severity plus the provider's own incidents, and for
 * a status page that is the whole truth: the reason it says "degraded" is the
 * incident sitting next to the word. A probe has no incidents, so "down" and
 * "down because it answered 503 instead of 2xx" look identical in the data —
 * and the second is the one an operator can act on. The note is that sentence,
 * shown verbatim in the diagnostics panel beside the failed reads.
 */
export interface ReadingNote {
  /** Free text, in English, shown as written. */
  text: string;
  /**
   * The target never answered at all — no status line, as opposed to a bad
   * one. The poller reads this across the whole fleet: a cycle in which
   * nothing anywhere answered is far more likely to be our own network than
   * every provider failing at once.
   */
  unreachable?: boolean | undefined;
}

export interface FetchContext {
  timeoutMs: number;
  /**
   * Reports each read the adapter makes over HTTP, so the caller can record how
   * long the provider's page took to answer. Adapters forward it to
   * `fetchConditional` and do nothing else with it; the poller is the only
   * caller that supplies one.
   */
  onRead?: ((read: StatusPageRead) => void) | undefined;
  /**
   * Reports what the reading amounted to when the severity alone does not say
   * it. Optional on both sides: most adapters never call it, and the poller is
   * the only caller that supplies one.
   */
  onNote?: ((note: ReadingNote) => void) | undefined;
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
  /**
   * The component's current status, normalized. This is additive: the value
   * is already sitting in the same summary row an adapter parses to build the
   * rest of the preview, so populating it costs no extra fetch or parsing.
   * `listComponents` is a UI-only path — Light never calls it and never
   * constructs a `ComponentPreview` — so Light pays nothing for this field
   * either. Kept out of `NormalizedStatus.components`, which only ever holds
   * the operator's selected components: the diff engine walks that list and
   * fires one notification per changed entry, so widening it to every
   * component a provider lists would turn a single busy provider into a
   * notification storm.
   */
  status: OverallStatus;
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
