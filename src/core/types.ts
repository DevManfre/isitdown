/**
 * Data shapes shared by both editions. Behavioural contracts live in the
 * sibling `*.interface.ts` files; this file holds only inert shapes so that
 * anything may import it without pulling in a dependency.
 */

/** Normalised severity vocabulary. Providers' own words are mapped onto this. */
export type OverallStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "unknown";

export interface Incident {
  id: string;
  /** Provider's own incident title. Empty string when the provider omits it. */
  name: string;
  /** Provider's own impact word, e.g. "minor". Not normalised. */
  impact: string;
  /** Provider's own lifecycle word, e.g. "investigating". Not normalised. */
  status: string;
  /** ISO 8601, UTC. */
  updatedAt: string;
}

export interface NormalizedStatus {
  provider: string;
  overallStatus: OverallStatus;
  activeIncidents: Incident[];
  /** ISO 8601, UTC. When the poll that produced this completed. */
  fetchedAt: string;
}

export type StatusChangeKind =
  | "status_change"
  | "incident_opened"
  | "incident_updated"
  | "incident_resolved"
  | "monitoring_degraded";

/**
 * A transition worth telling the operator about. Produced only by the diff
 * engine, consumed only by the notification dispatcher.
 */
export interface StatusChange {
  kind: StatusChangeKind;
  providerId: string;
  /** Absent when there is no comparable prior state. */
  previousStatus?: OverallStatus | undefined;
  currentStatus: OverallStatus;
  /** Present for every incident_* kind. */
  incident?: Incident | undefined;
  /** Present for monitoring_degraded only. */
  failureCount?: number | undefined;
  /** ISO 8601, UTC. */
  at: string;
}

export interface NotificationPayload {
  change: StatusChange;
  service: {
    id: string;
    name: string;
    /** The provider's public status page, linked from the message. */
    statusUrl: string;
  };
  locale: string;
}
