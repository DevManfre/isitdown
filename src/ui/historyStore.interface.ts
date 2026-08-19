import type { SentRecord } from "../core/notificationDispatcher.ts";
import type { StateStore } from "../core/stateStore.interface.ts";
import type { OverallStatus } from "../core/types.ts";

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

export interface HistoryStore extends StateStore {
  recordNotification(record: SentRecord): Promise<void>;
  listNotifications(limit: number): Promise<SentRecord[]>;
  listIncidents(filter: IncidentFilter): Promise<IncidentRow[]>;
  getIncident(providerId: string, incidentId: string): Promise<IncidentRow | null>;
  /** Newest first, for the incident view's poll strip. */
  getRecentSamples(providerId: string, limit: number): Promise<SampleRow[]>;
  pruneOlderThan(days: number): Promise<void>;
}
