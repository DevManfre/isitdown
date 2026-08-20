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
  state?: "active" | "resolved" | undefined;
  days?: number | undefined;
  limit?: number | undefined;
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
  /** Every configured provider, enabled or not: its history is real either way. */
  listProviderIds(): Promise<string[]>;
  recordNotification(record: SentRecord): Promise<void>;
  listNotifications(limit: number): Promise<SentRecord[]>;
  listIncidents(filter: IncidentFilter): Promise<IncidentRow[]>;
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
