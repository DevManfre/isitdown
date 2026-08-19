import type { DatabaseSync } from "node:sqlite";
import type { SentRecord } from "../core/notificationDispatcher.ts";
import type { ProviderRuntimeState } from "../core/stateStore.interface.ts";
import { incidentSchema } from "../core/status.schema.ts";
import type { Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { z } from "zod";
import type {
  DailyBucket,
  HistoryStore,
  IncidentFilter,
  IncidentRow,
  SampleRow,
} from "./historyStore.interface.ts";

const incidentsColumnSchema = z.array(incidentSchema);

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

const notificationRowSchema = z.object({
  provider_id: z.string(),
  channel: z.string(),
  kind: z.enum([
    "status_change",
    "incident_opened",
    "incident_updated",
    "incident_resolved",
    "monitoring_degraded",
  ]),
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

const RANK_CASE = `CASE overall_status ${Object.entries(SEVERITY_RANK)
  .map(([status, rank]) => `WHEN '${status}' THEN ${rank}`)
  .join(" ")} ELSE ${SEVERITY_RANK.major_outage} END`;

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

/**
 * The UI edition's store. It satisfies the shared StateStore contract exactly as
 * the Light edition's file store does, and adds the history the dashboard reads.
 *
 * `saveStatus` does three things in one transaction: it updates the current state,
 * appends one sample, and reconciles the incident table. Recording history inside
 * `saveStatus` is what keeps the core poller unaware that history exists at all,
 * and it guarantees the uptime bars and the incident timeline are derived from the
 * same write — the two views cannot disagree.
 *
 * A failed poll writes no sample: a failure of our own monitoring is reported as
 * `monitoring_degraded`, not as the provider's downtime.
 */
export function createSqliteStateStore(db: DatabaseSync): HistoryStore {
  const selectState = db.prepare(
    "SELECT overall_status, active_incidents, fetched_at, failure_count, degraded_notified FROM provider_state WHERE provider_id = ?",
  );
  const upsertState = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, fetched_at, failure_count, degraded_notified)
    VALUES (?, ?, ?, ?, 0, 0)
    ON CONFLICT (provider_id) DO UPDATE SET
      overall_status = excluded.overall_status,
      active_incidents = excluded.active_incidents,
      fetched_at = excluded.fetched_at
  `);
  const bumpFailure = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, fetched_at, failure_count, degraded_notified)
    VALUES (?, 'unknown', '[]', ?, 1, 0)
    ON CONFLICT (provider_id) DO UPDATE SET failure_count = failure_count + 1
  `);
  const clearFailure = db.prepare("UPDATE provider_state SET failure_count = 0 WHERE provider_id = ?");
  const setDegraded = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, fetched_at, failure_count, degraded_notified)
    VALUES (?, 'unknown', '[]', ?, 0, ?)
    ON CONFLICT (provider_id) DO UPDATE SET degraded_notified = excluded.degraded_notified
  `);
  const insertSample = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES (?, ?, ?, ?)",
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
          status.fetchedAt,
        );
        insertSample.run(
          status.provider,
          status.fetchedAt,
          status.overallStatus,
          status.overallStatus === "operational" ? 1 : 0,
        );

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

    async listNotifications(limit: number): Promise<SentRecord[]> {
      const rows = db
        .prepare(
          "SELECT provider_id, channel, kind, text, sent_at, ok, error FROM notifications ORDER BY sent_at DESC, id DESC LIMIT ?",
        )
        .all(limit)
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
      if (filter.state === "active") clauses.push("resolved_at IS NULL");
      if (filter.state === "resolved") clauses.push("resolved_at IS NOT NULL");
      if (filter.days !== undefined) {
        clauses.push("started_at >= ?");
        params.push(new Date(Date.now() - filter.days * 24 * 3600 * 1000).toISOString());
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      const limit = filter.limit === undefined ? "" : "LIMIT ?";
      if (filter.limit !== undefined) params.push(filter.limit);

      const rows = db
        .prepare(
          `SELECT provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at
           FROM incidents ${where} ORDER BY started_at DESC, incident_id DESC ${limit}`,
        )
        .all(...params)
        .map((raw) => incidentRowSchema.parse(raw));
      return rows.map(toIncidentRow);
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

    async getDailyBuckets(providerId: string, days: number): Promise<DailyBucket[]> {
      const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
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
      const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      db.prepare("DELETE FROM status_samples WHERE observed_at < ?").run(cutoff);
      db.prepare("DELETE FROM notifications WHERE sent_at < ?").run(cutoff);
      db.prepare("DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(cutoff);
    },

    async close(): Promise<void> {
      if (db.isOpen) db.close();
    },
  };
}
