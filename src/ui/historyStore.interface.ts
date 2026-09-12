import type { SentRecord } from "../core/notificationDispatcher.ts";
import type { MessageRefStore } from "../core/messageRefStore.interface.ts";
import type { StateStore } from "../core/stateStore.interface.ts";
import type { HistoricalIncident, MaintenanceWindow, OverallStatus } from "../core/types.ts";

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
  /**
   * Free text matched against the incident name, case-insensitively (roadmap
   * 5.19). Applied in SQL for the same reason `providerIds` is: the list is
   * paged and counted server-side, so searching a page already in hand would
   * search 20 rows and report the result as the whole history.
   */
  query?: string | undefined;
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

export interface MaintenanceFilter {
  providerId?: string | undefined;
  /** Same semantics as `IncidentFilter.providerIds`: an empty array matches nothing. */
  providerIds?: string[] | undefined;
  days?: number | undefined;
  /** `false` excludes windows whose `startsAt` is still in the future. */
  includeUpcoming?: boolean | undefined;
  limit?: number | undefined;
}

export type MaintenanceRow = MaintenanceWindow & {
  providerId: string;
  /** When we first saw this window, regardless of what the provider's own timestamps say. */
  firstSeenAt: string;
  /** When we most recently saw this window. */
  lastSeenAt: string;
};

export interface NotificationFilter {
  /** Same semantics as `IncidentFilter.providerIds`: an empty array matches nothing. */
  providerIds?: string[] | undefined;
  /** `failed` is the outcome the view leads with — a dead channel is the reason it exists. */
  state?: "sent" | "failed" | undefined;
  channel?: string | undefined;
  limit?: number | undefined;
  /** Rows to skip before the page starts. Honoured with or without `limit`. */
  offset?: number | undefined;
}

export interface NotificationCounts {
  all: number;
  sent: number;
  failed: number;
}

export interface DailyBucket {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Worst status seen that day. `unknown` only when nothing better was seen. */
  worstStatus: OverallStatus;
  okSamples: number;
  totalSamples: number;
}

/** One operator note on one incident (roadmap 5.3). */
export interface IncidentNote {
  id: number;
  body: string;
  createdAt: string;
}

export interface HistoryStore extends StateStore, MessageRefStore {
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
  /**
   * One page of the delivery log. Same discipline as the incident list: the
   * filter, the window and the counts are all SQL, because a page filtered in
   * the browser would report that page's totals as the whole log's.
   */
  queryNotifications(filter: NotificationFilter): Promise<SentRecord[]>;
  /**
   * How many sends match the filter, split by outcome — the delivery log's
   * pills show every count while one state is on screen, so they cannot be
   * derived from the loaded page. `state`, `limit` and `offset` are ignored:
   * counting every outcome at once is the point.
   */
  countNotifications(
    filter: Omit<NotificationFilter, "state" | "limit" | "offset">,
  ): Promise<NotificationCounts>;
  listIncidents(filter: IncidentFilter): Promise<IncidentRow[]>;
  /**
   * The counts behind the incident list's pager and its filter pills. One
   * statement for all three numbers: a paged list cannot derive them from the
   * rows it loaded, and three COUNT queries would scan the same index three
   * times. `state` is ignored — counting every state at once is the point.
   */
  countIncidents(filter: Omit<IncidentFilter, "state" | "limit" | "offset">): Promise<IncidentCounts>;
  getIncident(providerId: string, incidentId: string): Promise<IncidentRow | null>;
  /**
   * The operator's own notes on one incident, oldest first — roadmap 5.3. The
   * one thing about an incident IsItDown can never observe: why it mattered
   * here. Oldest first because they read as a small log, the way the timeline
   * beside them does.
   */
  listIncidentNotes(providerId: string, incidentId: string): Promise<IncidentNote[]>;
  /** Returns the stored note, so the caller never has to re-read to render it. */
  addIncidentNote(providerId: string, incidentId: string, body: string): Promise<IncidentNote>;
  /** False when the note is not this incident's, or is already gone. */
  deleteIncidentNote(providerId: string, incidentId: string, id: number): Promise<boolean>;
  /** Newest first by `startsAt`. */
  listMaintenances(filter: MaintenanceFilter): Promise<MaintenanceRow[]>;
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
