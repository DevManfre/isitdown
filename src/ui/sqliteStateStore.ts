import type { DatabaseSync } from "node:sqlite";
import type { SentRecord } from "../core/notificationDispatcher.ts";
import type { ProviderRuntimeState } from "../core/stateStore.interface.ts";
import { componentStatusSchema, incidentSchema, maintenanceWindowSchema } from "../core/status.schema.ts";
import { STATUS_CHANGE_KINDS } from "../core/types.ts";
import type { HistoricalIncident, Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { z } from "zod";
import type {
  DailyBucket,
  HistoryStore,
  IncidentCounts,
  IncidentFilter,
  IncidentRow,
  MaintenanceFilter,
  MaintenanceRow,
  SampleRow,
} from "./historyStore.interface.ts";

const incidentsColumnSchema = z.array(incidentSchema);
const componentsColumnSchema = z.array(componentStatusSchema);
const maintenancesColumnSchema = z.array(maintenanceWindowSchema);

/**
 * Rows come back from SQLite untyped, and a column read is external input like a
 * provider's JSON is. Validating here rather than casting means a schema drift
 * shows up as a clear error instead of an `undefined` three layers away.
 */
const overallStatusSchema = z.enum([
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "unknown",
]);

const stateRowSchema = z.object({
  overall_status: overallStatusSchema,
  active_incidents: z.string(),
  components: z.string(),
  maintenances: z.string(),
  fetched_at: z.string(),
  failure_count: z.number(),
  degraded_notified: z.number(),
});

const incidentRowSchema = z.object({
  provider_id: z.string(),
  incident_id: z.string(),
  name: z.string(),
  impact: z.string(),
  status: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
});

const maintenanceRowSchema = z.object({
  provider_id: z.string(),
  maintenance_id: z.string(),
  name: z.string(),
  status: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  component_ids: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
});

/** `SUM(...)` is NULL, not 0, when no row matches the WHERE clause. */
const incidentCountsSchema = z.object({
  all_count: z.number(),
  active_count: z.number().nullable().transform((value) => value ?? 0),
});

const notificationRowSchema = z.object({
  provider_id: z.string(),
  channel: z.string(),
  // Built from the same tuple StatusChangeKind is derived from, not
  // hand-mirrored: a hand-mirrored copy is exactly what fell one kind behind
  // and took down every notification-listing view mid-branch.
  kind: z.enum(STATUS_CHANGE_KINDS),
  text: z.string(),
  sent_at: z.string(),
  ok: z.number(),
  error: z.string().nullable(),
});

const bucketRowSchema = z.object({
  day: z.string(),
  worst: z.number(),
  ok_samples: z.number(),
  total_samples: z.number(),
});

const sampleRowSchema = z.object({
  observed_at: z.string(),
  overall_status: overallStatusSchema,
  ok: z.number(),
});

type IncidentDbRow = z.infer<typeof incidentRowSchema>;
type MaintenanceDbRow = z.infer<typeof maintenanceRowSchema>;

/**
 * Severity rank used to pick a day's bucket. `unknown` ranks lowest on purpose:
 * a day holding one unclassifiable sample among good ones reads as operational,
 * and only a day with nothing but unknowns reads as unknown.
 */
const SEVERITY_RANK: Record<OverallStatus, number> = {
  unknown: 0,
  operational: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

const RANK_TO_STATUS = Object.fromEntries(
  Object.entries(SEVERITY_RANK).map(([status, rank]) => [rank, status as OverallStatus]),
) as Record<number, OverallStatus>;

const rankCaseFor = (column: string): string =>
  `CASE ${column} ${Object.entries(SEVERITY_RANK)
    .map(([status, rank]) => `WHEN '${status}' THEN ${rank}`)
    .join(" ")} ELSE ${SEVERITY_RANK.major_outage} END`;
const RANK_CASE = rankCaseFor("overall_status");

/**
 * A provider's own timestamp is untrusted input like the rest of its payload.
 * One ahead of our clock would make the incident resolve "before" it started and
 * every duration derived from it negative, so the start time is pinned to when we
 * first observed the incident. The provider's own claim is still kept as
 * `updated_at`.
 */
function startedAt(providerUpdatedAt: string, observedAt: string): string {
  const claimed = Date.parse(providerUpdatedAt);
  const observed = Date.parse(observedAt);
  if (Number.isNaN(claimed) || claimed > observed) return observedAt;
  return providerUpdatedAt;
}

const baseline = (): ProviderRuntimeState => ({
  last: null,
  failureCount: 0,
  degradedNotified: false,
});

const toIncidentRow = (row: IncidentDbRow): IncidentRow => ({
  providerId: row.provider_id,
  incidentId: row.incident_id,
  name: row.name,
  impact: row.impact,
  status: row.status,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
});

const toMaintenanceRow = (row: MaintenanceDbRow): MaintenanceRow => ({
  providerId: row.provider_id,
  id: row.maintenance_id,
  name: row.name,
  status: row.status,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  componentIds: z.array(z.string()).parse(JSON.parse(row.component_ids)),
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * A `provider_id` allow-list as a clause and its parameters, or null when the
 * caller asked for no restriction at all.
 *
 * An empty list becomes `1 = 0` rather than nothing: SQLite rejects `IN ()`,
 * and "every provider is disabled" has to match no rows instead of falling
 * through to all of them.
 */
function providerScope(
  providerIds: string[] | undefined,
): { clause: string; params: string[] } | null {
  if (providerIds === undefined) return null;
  if (providerIds.length === 0) return { clause: "1 = 0", params: [] };
  return {
    clause: `provider_id IN (${providerIds.map(() => "?").join(", ")})`,
    params: providerIds,
  };
}

/**
 * The UI edition's store. It satisfies the shared StateStore contract exactly as
 * the Light edition's file store does, and adds the history the dashboard reads.
 *
 * `saveStatus` does several things in one transaction: it updates the current
 * state, appends one status sample and one component sample per non-`unknown`
 * component, and reconciles the incident table. Recording history inside
 * `saveStatus` is what keeps the core poller unaware that history exists at all,
 * and it guarantees the uptime bars and the incident timeline are derived from the
 * same write — the two views cannot disagree.
 *
 * A failed poll writes no sample: a failure of our own monitoring is reported as
 * `monitoring_degraded`, not as the provider's downtime.
 */
export interface SqliteStateStoreDeps {
  /** Injected so a day or retention window does not depend on when a test runs. */
  now?: (() => Date) | undefined;
}

export function createSqliteStateStore(db: DatabaseSync, deps: SqliteStateStoreDeps = {}): HistoryStore {
  const now = deps.now ?? ((): Date => new Date());
  const selectState = db.prepare(
    "SELECT overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified FROM provider_state WHERE provider_id = ?",
  );
  const upsertState = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    ON CONFLICT (provider_id) DO UPDATE SET
      overall_status = excluded.overall_status,
      active_incidents = excluded.active_incidents,
      components = excluded.components,
      maintenances = excluded.maintenances,
      fetched_at = excluded.fetched_at
  `);
  const bumpFailure = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified)
    VALUES (?, 'unknown', '[]', '[]', '[]', ?, 1, 0)
    ON CONFLICT (provider_id) DO UPDATE SET failure_count = failure_count + 1
  `);
  const clearFailure = db.prepare("UPDATE provider_state SET failure_count = 0 WHERE provider_id = ?");
  const setDegraded = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified)
    VALUES (?, 'unknown', '[]', '[]', '[]', ?, 0, ?)
    ON CONFLICT (provider_id) DO UPDATE SET degraded_notified = excluded.degraded_notified
  `);
  const insertSample = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, ?, ?)",
  );
  const insertComponentSample = db.prepare(
    "INSERT INTO component_samples (provider_id, component_id, observed_at, status, ok) VALUES (?, ?, ?, ?, ?)",
  );
  const upsertIncident = db.prepare(`
    INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT (provider_id, incident_id) DO UPDATE SET
      name = excluded.name,
      impact = excluded.impact,
      status = excluded.status,
      updated_at = excluded.updated_at,
      resolved_at = NULL
  `);
  const resolveMissing = db.prepare(
    "UPDATE incidents SET resolved_at = ? WHERE provider_id = ? AND resolved_at IS NULL",
  );
  const insertNotification = db.prepare(
    "INSERT INTO notifications (provider_id, channel, kind, text, sent_at, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const selectEarliestSampleTime = db.prepare(
    "SELECT MIN(observed_at) AS earliest FROM status_samples WHERE provider_id = ?",
  );
  const insertBackfillIncident = db.prepare(`
    INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider_id, incident_id) DO NOTHING
  `);
  const upsertMaintenance = db.prepare(`
    INSERT INTO maintenances (provider_id, maintenance_id, name, status, starts_at, ends_at, component_ids, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider_id, maintenance_id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      component_ids = excluded.component_ids,
      last_seen_at = excluded.last_seen_at
  `);

  function readIncidents(json: string): Incident[] {
    return incidentsColumnSchema.parse(JSON.parse(json));
  }

  return {
    async getState(providerId: string): Promise<ProviderRuntimeState> {
      const raw = selectState.get(providerId);
      if (raw === undefined) return baseline();
      const row = stateRowSchema.parse(raw);
      return {
        last:
          row.fetched_at === ""
            ? null
            : {
                provider: providerId,
                overallStatus: row.overall_status,
                activeIncidents: readIncidents(row.active_incidents),
                components: componentsColumnSchema.parse(JSON.parse(row.components)),
                maintenances: maintenancesColumnSchema.parse(JSON.parse(row.maintenances)),
                fetchedAt: row.fetched_at,
              },
        failureCount: row.failure_count,
        degradedNotified: row.degraded_notified === 1,
      };
    },

    async saveStatus(status: NormalizedStatus): Promise<void> {
      db.exec("BEGIN");
      try {
        upsertState.run(
          status.provider,
          status.overallStatus,
          JSON.stringify(status.activeIncidents),
          JSON.stringify(status.components),
          JSON.stringify(status.maintenances),
          status.fetchedAt,
        );
        insertSample.run(
          status.provider,
          status.fetchedAt,
          status.overallStatus,
          status.overallStatus === "operational" ? 1 : 0,
        );

        // `unknown` writes no sample: an unmeasured component must not read as
        // downtime, and a gap-filled day already renders as unknown in the bars.
        for (const component of status.components) {
          if (component.status === "unknown") continue;
          insertComponentSample.run(
            status.provider,
            component.id,
            status.fetchedAt,
            component.status,
            component.status === "operational" ? 1 : 0,
          );
        }

        // Resolve first, then reopen or update whatever is still active: an
        // incident present in this poll ends up with resolved_at NULL either way.
        resolveMissing.run(status.fetchedAt, status.provider);
        for (const incident of status.activeIncidents) {
          upsertIncident.run(
            status.provider,
            incident.id,
            incident.name,
            incident.impact,
            incident.status,
            startedAt(incident.updatedAt, status.fetchedAt),
            incident.updatedAt,
          );
        }

        for (const maintenance of status.maintenances) {
          upsertMaintenance.run(
            status.provider,
            maintenance.id,
            maintenance.name,
            maintenance.status,
            maintenance.startsAt,
            maintenance.endsAt,
            JSON.stringify(maintenance.componentIds),
            status.fetchedAt,
            status.fetchedAt,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    async recordFailure(providerId: string): Promise<number> {
      bumpFailure.run(providerId, "");
      const raw = selectState.get(providerId);
      return raw === undefined ? 0 : stateRowSchema.parse(raw).failure_count;
    },

    async clearFailures(providerId: string): Promise<void> {
      clearFailure.run(providerId);
    },

    async setDegradedNotified(providerId: string, value: boolean): Promise<void> {
      setDegraded.run(providerId, "", value ? 1 : 0);
    },

    async recordNotification(record: SentRecord): Promise<void> {
      insertNotification.run(
        record.providerId,
        record.channel,
        record.kind,
        record.text,
        record.sentAt,
        record.ok ? 1 : 0,
        record.error ?? null,
      );
    },

    async listNotifications(
      limit: number,
      providerIds?: string[] | undefined,
    ): Promise<SentRecord[]> {
      const scope = providerScope(providerIds);
      const where = scope === null ? "" : `WHERE ${scope.clause}`;
      const rows = db
        .prepare(
          `SELECT provider_id, channel, kind, text, sent_at, ok, error
           FROM notifications ${where} ORDER BY sent_at DESC, id DESC LIMIT ?`,
        )
        .all(...(scope?.params ?? []), limit)
        .map((raw) => notificationRowSchema.parse(raw));
      return rows.map((row) => ({
        providerId: row.provider_id,
        channel: row.channel,
        kind: row.kind,
        text: row.text,
        sentAt: row.sent_at,
        ok: row.ok === 1,
        ...(row.error === null ? {} : { error: row.error }),
      }));
    },

    async listIncidents(filter: IncidentFilter): Promise<IncidentRow[]> {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.providerId !== undefined) {
        clauses.push("provider_id = ?");
        params.push(filter.providerId);
      }
      const scope = providerScope(filter.providerIds);
      if (scope !== null) {
        clauses.push(scope.clause);
        params.push(...scope.params);
      }
      if (filter.state === "active") clauses.push("resolved_at IS NULL");
      if (filter.state === "resolved") clauses.push("resolved_at IS NOT NULL");
      if (filter.days !== undefined) {
        clauses.push("started_at >= ?");
        params.push(new Date(now().getTime() - filter.days * 24 * 3600 * 1000).toISOString());
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      // SQLite has no bare OFFSET: skipping rows without a page size means asking
      // for every remaining one, which is what `LIMIT -1` spells.
      const window = filter.limit === undefined && filter.offset === undefined ? "" : "LIMIT ? OFFSET ?";
      if (window !== "") params.push(filter.limit ?? -1, filter.offset ?? 0);

      const rows = db
        .prepare(
          `SELECT provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at
           FROM incidents ${where} ORDER BY started_at DESC, incident_id DESC ${window}`,
        )
        .all(...params)
        .map((raw) => incidentRowSchema.parse(raw));
      return rows.map(toIncidentRow);
    },

    async countIncidents(filter: Omit<IncidentFilter, "state" | "limit" | "offset">): Promise<IncidentCounts> {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.providerId !== undefined) {
        clauses.push("provider_id = ?");
        params.push(filter.providerId);
      }
      const scope = providerScope(filter.providerIds);
      if (scope !== null) {
        clauses.push(scope.clause);
        params.push(...scope.params);
      }
      if (filter.days !== undefined) {
        clauses.push("started_at >= ?");
        params.push(new Date(now().getTime() - filter.days * 24 * 3600 * 1000).toISOString());
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;

      const row = db
        .prepare(
          `SELECT COUNT(*) AS all_count,
                  SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS active_count
           FROM incidents ${where}`,
        )
        .get(...params);
      const { all_count, active_count } = incidentCountsSchema.parse(row);
      return { all: all_count, active: active_count, resolved: all_count - active_count };
    },

    async getIncident(providerId: string, incidentId: string): Promise<IncidentRow | null> {
      const row = db
        .prepare(
          `SELECT provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at
           FROM incidents WHERE provider_id = ? AND incident_id = ?`,
        )
        .get(providerId, incidentId);
      return row === undefined ? null : toIncidentRow(incidentRowSchema.parse(row));
    },

    async listMaintenances(filter: MaintenanceFilter): Promise<MaintenanceRow[]> {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter.providerId !== undefined) {
        clauses.push("provider_id = ?");
        params.push(filter.providerId);
      }
      const scope = providerScope(filter.providerIds);
      if (scope !== null) {
        clauses.push(scope.clause);
        params.push(...scope.params);
      }
      if (filter.days !== undefined) {
        clauses.push("starts_at >= ?");
        params.push(new Date(now().getTime() - filter.days * 24 * 3600 * 1000).toISOString());
      }
      if (filter.includeUpcoming === false) {
        clauses.push("starts_at <= ?");
        params.push(now().toISOString());
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      const limit = filter.limit;
      if (limit !== undefined) params.push(limit);

      const rows = db
        .prepare(
          `SELECT provider_id, maintenance_id, name, status, starts_at, ends_at, component_ids, first_seen_at, last_seen_at
           FROM maintenances ${where} ORDER BY starts_at DESC ${limit === undefined ? "" : "LIMIT ?"}`,
        )
        .all(...params)
        .map((raw) => maintenanceRowSchema.parse(raw));
      return rows.map(toMaintenanceRow);
    },

    async getDailyBuckets(providerId: string, days: number): Promise<DailyBucket[]> {
      const from = new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
      const rows = db
        .prepare(
          `SELECT date(observed_at) AS day,
                  MAX(${RANK_CASE}) AS worst,
                  SUM(ok) AS ok_samples,
                  COUNT(*) AS total_samples
           FROM status_samples
           WHERE provider_id = ? AND observed_at >= ?
           GROUP BY day
           ORDER BY day ASC`,
        )
        .all(providerId, from)
        .map((raw) => bucketRowSchema.parse(raw));

      return rows.map((row) => ({
        day: row.day,
        worstStatus: RANK_TO_STATUS[row.worst] ?? "unknown",
        okSamples: row.ok_samples,
        totalSamples: row.total_samples,
      }));
    },

    async getComponentDailyBuckets(providerId: string, componentId: string, days: number): Promise<DailyBucket[]> {
      const from = new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
      const rows = db
        .prepare(
          `SELECT date(observed_at) AS day,
                  MAX(${rankCaseFor("status")}) AS worst,
                  SUM(ok) AS ok_samples,
                  COUNT(*) AS total_samples
           FROM component_samples
           WHERE provider_id = ? AND component_id = ? AND observed_at >= ?
           GROUP BY day
           ORDER BY day ASC`,
        )
        .all(providerId, componentId, from)
        .map((raw) => bucketRowSchema.parse(raw));

      return rows.map((row) => ({
        day: row.day,
        worstStatus: RANK_TO_STATUS[row.worst] ?? "unknown",
        okSamples: row.ok_samples,
        totalSamples: row.total_samples,
      }));
    },

    async listProviderIds(): Promise<string[]> {
      return db
        .prepare("SELECT id FROM services ORDER BY id")
        .all()
        .map((raw) => z.object({ id: z.string() }).parse(raw).id);
    },

    async getRecentSamples(providerId: string, limit: number): Promise<SampleRow[]> {
      const rows = db
        .prepare(
          "SELECT observed_at, overall_status, ok FROM status_samples WHERE provider_id = ? ORDER BY observed_at DESC, id DESC LIMIT ?",
        )
        .all(providerId, limit)
        .map((raw) => sampleRowSchema.parse(raw));
      return rows.map((row) => ({
        observedAt: row.observed_at,
        overallStatus: row.overall_status,
        ok: row.ok === 1,
      }));
    },

    async pruneOlderThan(days: number): Promise<void> {
      const cutoff = new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
      db.prepare("DELETE FROM status_samples WHERE observed_at < ?").run(cutoff);
      db.prepare("DELETE FROM component_samples WHERE observed_at < ?").run(cutoff);
      db.prepare("DELETE FROM notifications WHERE sent_at < ?").run(cutoff);
      db.prepare("DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(cutoff);
      db.prepare("DELETE FROM maintenances WHERE ends_at IS NOT NULL AND ends_at < ?").run(cutoff);
    },

    async getEarliestSampleTime(providerId: string): Promise<string | null> {
      const raw = selectEarliestSampleTime.get(providerId);
      const row = z.object({ earliest: z.string().nullable() }).parse(raw);
      return row.earliest;
    },

    async applyBackfill(
      providerId: string,
      data: { samples: SampleRow[]; incidents: HistoricalIncident[] },
    ): Promise<void> {
      db.exec("BEGIN");
      try {
        // Insert samples as-is: do not create provider_state.
        for (const sample of data.samples) {
          insertSample.run(providerId, sample.observedAt, sample.overallStatus, sample.ok ? 1 : 0);
        }
        // Insert incidents with ON CONFLICT DO NOTHING: the live path owns the row
        // if it already exists, backfill never overwrites.
        for (const incident of data.incidents) {
          insertBackfillIncident.run(
            providerId,
            incident.id,
            incident.name,
            incident.impact,
            incident.status,
            incident.startedAt,
            incident.updatedAt,
            incident.resolvedAt,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    async close(): Promise<void> {
      if (db.isOpen) db.close();
    },
  };
}
