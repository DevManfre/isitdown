/**
 * Payload shapes the React dashboard receives from the UI edition's HTTP API.
 * Mirrors the server's own shapes: `ProviderStatus` is exactly what
 * `src/ui/routes/status.routes.ts` assembles; `ProviderHistory`,
 * `ComponentHistory` and `HistorySummary` come from `src/ui/history.ts`;
 * `IncidentRow` and `SampleRow` from `src/ui/historyStore.interface.ts`;
 * `SentRecord` from `src/core/notificationDispatcher.ts`; the config response
 * shapes from `src/ui/dbConfigSource.ts` (the API never returns the internal
 * `RuntimeConfig`/`ChannelConfig` shapes core uses — channel credentials are
 * redacted to "is this env var set", never the resolved secret).
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
  name: string;
  impact: string;
  status: string;
  updatedAt: string;
}

export interface ComponentStatus {
  id: string;
  name: string;
  status: OverallStatus;
}

/** A maintenance window a provider declared on its own status page. */
export interface MaintenanceWindow {
  id: string;
  /** Provider's own title. Empty string when the provider omits it. */
  name: string;
  /** Provider's own lifecycle word, e.g. "in_progress". Not normalised. */
  status: string;
  /** ISO 8601, UTC. */
  startsAt: string;
  /** ISO 8601, UTC. Null when the provider declares no end. */
  endsAt: string | null;
  /** Components the provider attributed it to; empty means page-wide. */
  componentIds: string[];
}

export interface ProviderStatus {
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  overallStatus: OverallStatus;
  activeIncidents: Incident[];
  components: ComponentStatus[];
  componentSelection: { id: string; name: string }[];
  scopeToComponents: boolean;
  fetchedAt: string | null;
  failureCount: number;
  uptime90: number;
  /** Running now, and windows still to come — a window that has already ended appears in neither. */
  maintenance: { active: MaintenanceWindow[]; upcoming: MaintenanceWindow[] };
}

export interface StatusResponse {
  providers: ProviderStatus[];
  pollIntervalMinutes: number;
  lastPollAt: string | null;
  nextPollAt: string | null;
  /**
   * What the server's clock read as it answered. Optional because the
   * dashboard has to degrade gracefully without it (a response served from
   * cache, an older server) — it then falls back to the browser's clock.
   */
  serverNow?: string | null;
}

export interface HistoryBucket {
  day: string;
  status: OverallStatus;
}

export interface DayUptime {
  day: string;
  /** null = nothing sampled that day. Never 0, which would mean a full outage. */
  uptime: number | null;
}

export interface ProviderHistory {
  providerId: string;
  /** Exactly `days` entries, oldest first, gap-filled with `unknown`. */
  buckets: HistoryBucket[];
  uptime7: number;
  uptime30: number;
  uptime90: number;
  /**
   * Samples backing the percentages in the window. Zero means never measured,
   * a different statement from 0% uptime, which must not be averaged in.
   */
  sampleCount: number;
  incidentCount: number;
  downtimeMinutes: number;
  /** Exactly `days` entries, oldest first, gap-filled with `uptime: null`. */
  dailySeries: DayUptime[];
  /** The equal-length window before this one. null = nothing measured then. */
  previousUptime: number | null;
}

export interface ComponentHistory {
  componentId: string;
  name: string;
  buckets: HistoryBucket[];
  uptime7: number;
  uptime30: number;
  uptime90: number;
  sampleCount: number;
}

export interface HistorySummary {
  aggregateUptime: number;
  /** Fleet uptime per day: unweighted mean across the providers measured. */
  dailyUptime: DayUptime[];
  /**
   * The fleet's change against the previous window of equal length, in
   * percentage points. Computed server-side over the providers with samples
   * in both windows — see `HistorySummary` in `src/ui/history.ts` for why.
   * null = no comparison exists.
   */
  aggregateDelta: number | null;
  /** `uptime` null for a month with no samples: 0% would read as an outage. */
  months: { month: string; uptime: number | null }[];
  providers: ProviderHistory[];
}

export interface ComponentHistoryResponse {
  provider: string;
  days: number;
  components: ComponentHistory[];
}

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

/** Which slice of the incident list the view is asking for. */
export type IncidentState = "all" | "active" | "resolved";

export interface IncidentPage {
  items: IncidentRow[];
  page: number;
  pageSize: number;
  /** Rows matching the requested state, not the page's length. */
  total: number;
}

export interface IncidentsResponse {
  /** The hero card's own rows: on screen under every filter, on every page. */
  active: IncidentRow[];
  page: IncidentPage;
  /** Every state's count, whichever one the page is showing. */
  counts: Record<IncidentState, number>;
}

/** A declared maintenance window, plus which provider and when we first/last saw it. */
export type MaintenanceRow = MaintenanceWindow & {
  providerId: string;
  /** ISO 8601, UTC. When we first saw the window, regardless of what the provider's own timestamps say. */
  firstSeenAt: string;
  /** ISO 8601, UTC. */
  lastSeenAt: string;
};

export interface MaintenancesResponse {
  /** Newest first by `startsAt`. */
  maintenances: MaintenanceRow[];
}

export interface TimelineEntry {
  at: string;
  label: "opened" | "observed" | "resolved";
  status?: string;
}

export interface SampleRow {
  observedAt: string;
  overallStatus: OverallStatus;
  ok: boolean;
}

/** The kinds of transition the diff engine can raise a notification for. */
export type StatusChangeKind =
  | "status_change"
  | "component_status_change"
  | "incident_opened"
  | "incident_updated"
  | "incident_resolved"
  | "maintenance_started"
  | "maintenance_ended"
  | "monitoring_degraded";

/**
 * One dispatch attempt, delivered or failed. Field list follows
 * `src/core/notificationDispatcher.ts`'s `SentRecord`, not a guess: the
 * channel id is `channel` (not `channelId`), the outcome flag is `ok` (not
 * `delivered`), and the rendered message is `text` (not `title`).
 */
export interface SentRecord {
  providerId: string;
  channel: string;
  kind: StatusChangeKind;
  text: string;
  sentAt: string;
  ok: boolean;
  error?: string;
}

export interface IncidentDetail {
  incident: IncidentRow;
  timeline: TimelineEntry[];
  actionLog: SentRecord[];
  polls: SampleRow[];
  otherActiveIncidents: IncidentRow[];
}

export interface ServiceDefinition {
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  /** Adapter-specific extras (e.g. a region). Absent when the adapter needs none. */
  options?: Record<string, string>;
  components: { id: string; name: string }[];
  scopeToComponents: boolean;
}

/** One credential field a channel needs: whether its env var is actually set, never its value. */
export interface DescribedField {
  name: string;
  envVar: string;
  isSet: boolean;
}

/** The only channel shape the API ever returns — no resolved secret leaves the server. */
export interface DescribedChannel {
  id: string;
  enabled: boolean;
  fields: DescribedField[];
}

/**
 * One component a `previewComponents` call found on the provider's status
 * page, before any service row exists for it.
 */
export interface ComponentPreview {
  id: string;
  name: string;
  /** Resolved group label (e.g. a Cloudflare region), null for ungrouped. */
  group: string | null;
  /** Statuspage's "featured" flag; a hint for the picker, nothing more. */
  showcase: boolean;
}

/** Mirrors `src/core/routing.ts`'s own `EventClass`/`SeverityFloor`/`RoutingRule`. */
export type EventClass = "status" | "incident" | "maintenance" | "monitoring";
export type SeverityFloor = "any" | "degraded" | "partial_outage" | "major_outage";

export interface RoutingRule {
  provider: string;
  classes: EventClass[];
  minSeverity: SeverityFloor;
  channels: string[];
}

/**
 * `invalidRules` counts saved rules the server could not parse back out of
 * SQLite and is dropping from evaluation — stated rather than swallowed,
 * since either direction of drop silently changes routing.
 */
export interface RoutingResponse {
  rules: RoutingRule[];
  invalidRules: number;
}

export interface RuntimeConfigResponse {
  polling: {
    intervalMinutes: number;
    requestTimeoutSeconds: number;
    maxRetries: number;
    failureThreshold: number;
  };
  services: ServiceDefinition[];
  channels: DescribedChannel[];
  routing: RoutingResponse;
}

export interface MapPoint {
  providerId: string;
  providerName: string;
  componentId: string;
  name: string;
  lat: number;
  lon: number;
  status: OverallStatus;
  source: "iata" | "region";
}

export interface UnlocatedProvider {
  providerId: string;
  providerName: string;
  count: number;
}

export interface MapResponse {
  points: MapPoint[];
  unlocated: UnlocatedProvider[];
  /** Newest observation in the snapshot, null when nothing is stored yet. */
  generatedAt: string | null;
}

export type MapView = "off" | "map" | "globe";

export interface Preferences {
  theme: "light" | "dark" | "system";
  uiLocale: string;
  notificationLocale: string;
  mapView: MapView;
}
