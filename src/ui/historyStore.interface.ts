import type { SentRecord } from "../core/notificationDispatcher.ts";
import type { StateStore } from "../core/stateStore.interface.ts";
import type { HistoricalIncident, OverallStatus } from "../core/types.ts";

/**
 * What the UI edition needs on top of the shared StateStore: the history the
 * charts and the incident timeline read. Declared here rather than in core
 * because the UI is its only consumer — core stays unaware that history exists.
 */

export interface IncidentRow {
  providerId: string;
  incidentId: string;
  name: string;
  impact: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SampleRow {
  observedAt: string;
  overallStatus: OverallStatus;
  ok: boolean;
}

export interface IncidentFilter {
  providerId?: string | undefined;
  /**
   * The only providers whose rows may be returned — how a disabled provider
   * leaves the dashboard's lists. It has to be applied in SQL rather than by
   * the caller: the list is paged and counted server-side, so dropping rows
   * from a page in hand would page and count the disabled ones anyway. An
   * empty array means no provider qualifies, and matches nothing.
   */
  providerIds?: string[] | undefined;
  state?: "active" | "resolved" | undefined;
  days?: number | undefined;
  limit?: number | undefined;
  /** Rows to skip before the page starts. Honoured with or without a `limit`. */
  offset?: number | undefined;
}

/** How many incidents match a filter, split by state — the paged list's totals. */
export interface IncidentCounts {
  all: number;
  active: number;
  resolved: number;
}

export interface DailyBucket {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Worst status seen that day. `unknown` only when nothing better was seen. */
  worstStatus: OverallStatus;
  okSamples: number;
  totalSamples: number;
}

export interface HistoryStore extends StateStore {
  /** One row per day that has samples, oldest first. Days with none are absent. */
  getDailyBuckets(providerId: string, days: number): Promise<DailyBucket[]>;
  /** Daily buckets for one selected component, same shape as the provider's. */
  getComponentDailyBuckets(providerId: string, componentId: string, days: number): Promise<DailyBucket[]>;
  /** Every configured provider, enabled or not: its history is real either way. */
  listProviderIds(): Promise<string[]>;
  recordNotification(record: SentRecord): Promise<void>;
  /**
   * Newest first. `providerIds` narrows the feed the same way it narrows the
   * incident list, and for the same reason: the limit is applied by the query,
   * so filtering afterwards would return fewer rows than were asked for.
   */
  listNotifications(limit: number, providerIds?: string[] | undefined): Promise<SentRecord[]>;
  listIncidents(filter: IncidentFilter): Promise<IncidentRow[]>;
  /**
   * The counts behind the incident list's pager and its filter pills. One
   * statement for all three numbers: a paged list cannot derive them from the
   * rows it loaded, and three COUNT queries would scan the same index three
   * times. `state` is ignored — counting every state at once is the point.
   */
  countIncidents(filter: Omit<IncidentFilter, "state" | "limit" | "offset">): Promise<IncidentCounts>;
  getIncident(providerId: string, incidentId: string): Promise<IncidentRow | null>;
  /** Newest first, for the incident view's poll strip. */
  getRecentSamples(providerId: string, limit: number): Promise<SampleRow[]>;
  pruneOlderThan(days: number): Promise<void>;
  /** MIN(observed_at) for the provider, or null when it has no samples yet. */
  getEarliestSampleTime(providerId: string): Promise<string | null>;
  /**
   * Backfill write path: samples plus historical incidents in one transaction.
   * Never touches provider_state — the first real poll must still see a null
   * baseline — and never overwrites an incident row the live path already owns.
   */
  applyBackfill(
    providerId: string,
    data: { samples: SampleRow[]; incidents: HistoricalIncident[] },
  ): Promise<void>;
}
