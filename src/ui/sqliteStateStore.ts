import type { DatabaseSync } from "node:sqlite";
import type { DaySegment } from "./calendarDays.ts";
import type { PollCycle } from "./coverage.ts";
import type { SentRecord } from "../core/dispatcher.interface.ts";
import type { AckRecord } from "../core/ackStore.interface.ts";
import type { ProviderRuntimeState, SaveStatusMeta } from "../core/stateStore.interface.ts";
import { normalizedStatusSchema } from "../core/status.schema.ts";
import type {
  DampingState,
  HistoricalIncident,
  Incident,
  NormalizedStatus,
  Suspicion,
  Freshness,
} from "../core/types.ts";
import { z } from "zod";
import type {
  Annotation,
  DailyBucket,
  HistoryStore,
  IncidentCounts,
  IncidentFilter,
  IncidentNote,
  IncidentNoteHit,
  IncidentRow,
  MaintenanceFilter,
  MaintenanceRow,
  NotificationCounts,
  NotificationFilter,
  SampleRow,
} from "./historyStore.interface.ts";
import { rollback } from "./db/open.ts";
import {
  incidentsColumnSchema,
  componentsColumnSchema,
  maintenancesColumnSchema,
  suspicionsColumnSchema,
  freshnessColumnSchema,
  stateRowSchema,
  incidentRowSchema,
  annotationRowSchema,
  incidentNoteRowSchema,
  incidentNoteHitRowSchema,
  latencyRowSchema,
  maintenanceRowSchema,
  incidentCountsSchema,
  notificationCountsSchema,
  notificationRowSchema,
  pollCycleRowSchema,
  sampleRowSchema,
  rankCaseFor,
  shiftOf,
  bucketsOver,
  startedAt,
  baseline,
  toIncidentRow,
  toMaintenanceRow,
  toSentRecord,
  providerScope,
  likeTerm,
  RANK_CASE,
} from "./sqliteStateRows.ts";

/** How many whole readings are kept per provider for the replay (roadmap 5.12). */
export const READINGS_KEPT = 100;

export interface SqliteStateStoreDeps {
  /** Injected so a day or retention window does not depend on when a test runs. */
  now?: (() => Date) | undefined;
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
export function createSqliteStateStore(db: DatabaseSync, deps: SqliteStateStoreDeps = {}): HistoryStore {
  const now = deps.now ?? ((): Date => new Date());
  const selectState = db.prepare(
    `SELECT overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified,
            notify_baseline, pending_signature, pending_count, suspicions, freshness
     FROM provider_state WHERE provider_id = ?`,
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
  const setNotifyState = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified, notify_baseline, pending_signature, pending_count)
    VALUES (?, 'unknown', '[]', '[]', '[]', ?, 0, 0, ?, ?, ?)
    ON CONFLICT (provider_id) DO UPDATE SET
      notify_baseline = excluded.notify_baseline,
      pending_signature = excluded.pending_signature,
      pending_count = excluded.pending_count
  `);
  const setSuspicions = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified, suspicions)
    VALUES (?, 'unknown', '[]', '[]', '[]', '', 0, 0, ?)
    ON CONFLICT (provider_id) DO UPDATE SET suspicions = excluded.suspicions
  `);
  const setFreshness = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified, freshness)
    VALUES (?, 'unknown', '[]', '[]', '[]', '', 0, 0, ?)
    ON CONFLICT (provider_id) DO UPDATE SET freshness = excluded.freshness
  `);
  const setDegraded = db.prepare(`
    INSERT INTO provider_state (provider_id, overall_status, active_incidents, components, maintenances, fetched_at, failure_count, degraded_notified)
    VALUES (?, 'unknown', '[]', '[]', '[]', ?, 0, ?)
    ON CONFLICT (provider_id) DO UPDATE SET degraded_notified = excluded.degraded_notified
  `);
  const insertSample = db.prepare(
    "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok, latency_ms, adapter_version) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertReading = db.prepare(
    "INSERT INTO status_readings (provider_id, observed_at, reading) VALUES (?, ?, ?)",
  );
  // Newest ids win: a poll never writes an older reading than the last, so id
  // order is time order and the trim needs no timestamp comparison.
  const trimReadings = db.prepare(
    "DELETE FROM status_readings WHERE provider_id = ? AND id NOT IN (SELECT id FROM status_readings WHERE provider_id = ? ORDER BY id DESC LIMIT ?)",
  );
  const insertComponentSample = db.prepare(
    "INSERT INTO component_samples (provider_id, component_id, observed_at, status, ok, adapter_version) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const upsertIncident = db.prepare(`
    INSERT INTO incidents (provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at, declared_at, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT (provider_id, incident_id) DO UPDATE SET
      declared_at = COALESCE(incidents.declared_at, excluded.declared_at),
      name = excluded.name,
      impact = excluded.impact,
      status = excluded.status,
      updated_at = excluded.updated_at,
      resolved_at = NULL
  `);
  const selectFetchedAt = db.prepare("SELECT fetched_at FROM provider_state WHERE provider_id = ?");
  const resolveMissing = db.prepare(
    "UPDATE incidents SET resolved_at = ? WHERE provider_id = ? AND resolved_at IS NULL",
  );
  // Poller liveness — roadmap 10.1. Append-only and tiny: one row per cycle is
  // 480 rows a day at the three-minute default, which is two days of one
  // provider's samples.
  const insertPollCycle = db.prepare(
    "INSERT INTO poll_cycles (started_at, finished_at, interval_minutes, providers) VALUES (?, ?, ?, ?)",
  );

  const insertNotification = db.prepare(
    "INSERT INTO notifications (provider_id, channel, kind, text, sent_at, ok, error, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // Message editing (roadmap 3.19): one reference per channel per incident.
  // Upserted rather than inserted, because an edit can move the reference — a
  // channel that refuses an edit and takes a fresh send has a new message id
  // for the same incident.
  const selectMessageRef = db.prepare(
    "SELECT ref FROM message_refs WHERE channel = ? AND provider_id = ? AND incident_id = ?",
  );
  const upsertMessageRef = db.prepare(
    `INSERT INTO message_refs (channel, provider_id, incident_id, ref, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (channel, provider_id, incident_id) DO UPDATE SET ref = excluded.ref, updated_at = excluded.updated_at`,
  );
  const deleteMessageRef = db.prepare(
    "DELETE FROM message_refs WHERE channel = ? AND provider_id = ? AND incident_id = ?",
  );
  // Acknowledgements (roadmap 3.1). `OR IGNORE` is the "first hand wins" rule:
  // the insert changing no row is how `acknowledge` knows it was a second press.
  const insertAck = db.prepare(
    "INSERT OR IGNORE INTO acks (provider_id, acked_at, acked_by) VALUES (?, ?, ?)",
  );
  const selectAck = db.prepare("SELECT acked_at, acked_by FROM acks WHERE provider_id = ?");
  const deleteAck = db.prepare("DELETE FROM acks WHERE provider_id = ?");
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
        notifyBaseline:
          row.notify_baseline === null
            ? null
            : normalizedStatusSchema.parse(JSON.parse(row.notify_baseline)),
        pending:
          row.pending_signature === null
            ? null
            : { signature: row.pending_signature, count: row.pending_count },
        suspicions: suspicionsColumnSchema.parse(JSON.parse(row.suspicions)),
        freshness: freshnessColumnSchema.parse(row.freshness === null ? null : JSON.parse(row.freshness)),
      };
    },

    async saveStatus(status: NormalizedStatus, meta?: SaveStatusMeta | undefined): Promise<void> {
      db.exec("BEGIN");
      try {
        // Read before this reading overwrites it: whether anybody was watching
        // this provider before now decides whether a new incident's arrival
        // is a detection (roadmap 1.1) or just the first look at the page.
        const previous = selectFetchedAt.get(status.provider) as { fetched_at: string } | undefined;
        const watching = previous !== undefined && previous.fetched_at !== "";
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
          meta?.latencyMs ?? null,
          meta?.adapterVersion ?? null,
        );

        // The whole reading, for the replay (roadmap 5.12). Kept to the last few
        // dozen per provider: it answers "why did I get that alert", which is a
        // question about the last few hours, not history.
        insertReading.run(status.provider, status.fetchedAt, JSON.stringify(status));
        trimReadings.run(status.provider, status.provider, READINGS_KEPT);

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
            meta?.adapterVersion ?? null,
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
            incident.createdAt ?? null,
            watching ? status.fetchedAt : null,
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
        rollback(db);
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

    async setSuspicions(providerId: string, suspicions: Suspicion[]): Promise<void> {
      setSuspicions.run(providerId, JSON.stringify(suspicions));
    },

    async setFreshness(providerId: string, freshness: Freshness): Promise<void> {
      setFreshness.run(providerId, JSON.stringify(freshness));
    },

    async saveNotifyState(
      providerId: string,
      notifyBaseline: NormalizedStatus | null,
      pending: DampingState | null,
    ): Promise<void> {
      setNotifyState.run(
        providerId,
        "",
        notifyBaseline === null ? null : JSON.stringify(notifyBaseline),
        pending?.signature ?? null,
        pending?.count ?? 0,
      );
    },

    async getRef(channel: string, providerId: string, incidentId: string): Promise<string | null> {
      const row = selectMessageRef.get(channel, providerId, incidentId);
      if (row === undefined) return null;
      return z.object({ ref: z.string() }).parse(row).ref;
    },

    async saveRef(channel: string, providerId: string, incidentId: string, ref: string): Promise<void> {
      upsertMessageRef.run(channel, providerId, incidentId, ref, new Date().toISOString());
    },

    async forgetRef(channel: string, providerId: string, incidentId: string): Promise<void> {
      deleteMessageRef.run(channel, providerId, incidentId);
    },

    async acknowledge(providerId: string, by: string, at: string): Promise<boolean> {
      return insertAck.run(providerId, at, by).changes > 0;
    },

    async getAck(providerId: string): Promise<AckRecord | null> {
      const row = selectAck.get(providerId);
      if (row === undefined) return null;
      const parsed = z.object({ acked_at: z.string(), acked_by: z.string() }).parse(row);
      return { ackedAt: parsed.acked_at, ackedBy: parsed.acked_by };
    },

    async clearAck(providerId: string): Promise<void> {
      deleteAck.run(providerId);
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
        // Defaulted, not required: a caller from before retries existed
        // (roadmap 3.14) tried exactly once, which is what the column then
        // says — the same reading the migration gave the rows already stored.
        record.attempts ?? 1,
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
          `SELECT id, provider_id, channel, kind, text, sent_at, ok, error, attempts
           FROM notifications ${where} ORDER BY sent_at DESC, id DESC LIMIT ?`,
        )
        .all(...(scope?.params ?? []), limit)
        .map((raw) => notificationRowSchema.parse(raw));
      return rows.map(toSentRecord);
    },

    async queryNotifications(filter: NotificationFilter): Promise<SentRecord[]> {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      const scope = providerScope(filter.providerIds);
      if (scope !== null) {
        clauses.push(scope.clause);
        params.push(...scope.params);
      }
      if (filter.state !== undefined) {
        clauses.push("ok = ?");
        params.push(filter.state === "sent" ? 1 : 0);
      }
      if (filter.channel !== undefined) {
        clauses.push("channel = ?");
        params.push(filter.channel);
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      // SQLite has no bare OFFSET: skipping rows without a page size means
      // asking for the remaining ones, which is what `LIMIT -1` spells.
      const window = filter.limit === undefined && filter.offset === undefined ? "" : "LIMIT ? OFFSET ?";
      if (window !== "") params.push(filter.limit ?? -1, filter.offset ?? 0);

      return db
        .prepare(
          `SELECT id, provider_id, channel, kind, text, sent_at, ok, error, attempts
           FROM notifications ${where} ORDER BY sent_at DESC, id DESC ${window}`,
        )
        .all(...params)
        .map((raw) => notificationRowSchema.parse(raw))
        .map(toSentRecord);
    },

    async countNotifications(
      filter: Omit<NotificationFilter, "state" | "limit" | "offset">,
    ): Promise<NotificationCounts> {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      const scope = providerScope(filter.providerIds);
      if (scope !== null) {
        clauses.push(scope.clause);
        params.push(...scope.params);
      }
      if (filter.channel !== undefined) {
        clauses.push("channel = ?");
        params.push(filter.channel);
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS all_count, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS sent_count
           FROM notifications ${where}`,
        )
        .get(...params);
      const { all_count, sent_count } = notificationCountsSchema.parse(row);
      return { all: all_count, sent: sent_count, failed: all_count - sent_count };
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
      // "Open at any point in this range": it had started by the end of it, and
      // it had not been resolved before the start of it. Compared against the
      // day prefix of the stored timestamp, so a day bound means the whole day.
      if (filter.openTo !== undefined) {
        clauses.push("substr(started_at, 1, 10) <= ?");
        params.push(filter.openTo);
      }
      if (filter.openFrom !== undefined) {
        clauses.push("(resolved_at IS NULL OR substr(resolved_at, 1, 10) >= ?)");
        params.push(filter.openFrom);
      }
      const term = likeTerm(filter.query);
      if (term !== undefined) {
        clauses.push("name LIKE ? ESCAPE '\\'");
        params.push(term);
      }
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      // SQLite has no bare OFFSET: skipping rows without a page size means asking
      // for every remaining one, which is what `LIMIT -1` spells.
      const window = filter.limit === undefined && filter.offset === undefined ? "" : "LIMIT ? OFFSET ?";
      if (window !== "") params.push(filter.limit ?? -1, filter.offset ?? 0);

      const rows = db
        .prepare(
          `SELECT provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at, declared_at, first_seen_at
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
      const term = likeTerm(filter.query);
      if (term !== undefined) {
        clauses.push("name LIKE ? ESCAPE '\\'");
        params.push(term);
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
          `SELECT provider_id, incident_id, name, impact, status, started_at, updated_at, resolved_at, declared_at, first_seen_at
           FROM incidents WHERE provider_id = ? AND incident_id = ?`,
        )
        .get(providerId, incidentId);
      return row === undefined ? null : toIncidentRow(incidentRowSchema.parse(row));
    },

    async listIncidentNotes(providerId: string, incidentId: string): Promise<IncidentNote[]> {
      return (
        db
          .prepare(
            `SELECT id, body, created_at FROM incident_notes
             WHERE provider_id = ? AND incident_id = ?
             ORDER BY created_at, id`,
          )
          .all(providerId, incidentId) as unknown[]
      )
        .map((row) => incidentNoteRowSchema.parse(row))
        .map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at }));
    },

    async searchIncidentNotes(query: string, providerIds: string[], limit: number): Promise<IncidentNoteHit[]> {
      const term = likeTerm(query);
      if (term === undefined || providerIds.length === 0) return [];
      return (
        db
          .prepare(
            `SELECT n.id, n.body, n.created_at, n.provider_id, n.incident_id, i.name AS incident_name
             FROM incident_notes n
             LEFT JOIN incidents i ON i.provider_id = n.provider_id AND i.incident_id = n.incident_id
             WHERE n.body LIKE ? ESCAPE '\\' AND n.provider_id IN (${providerIds.map(() => "?").join(", ")})
             ORDER BY n.created_at DESC, n.id DESC
             LIMIT ?`,
          )
          .all(term, ...providerIds, limit) as unknown[]
      )
        .map((row) => incidentNoteHitRowSchema.parse(row))
        .map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.created_at,
          providerId: row.provider_id,
          incidentId: row.incident_id,
          incidentName: row.incident_name,
        }));
    },

    async searchAnnotations(query: string, providerIds: string[], limit: number): Promise<Annotation[]> {
      const term = likeTerm(query);
      if (term === undefined) return [];
      return db
        .prepare(
          `SELECT id, at, label, colour, provider_id, created_at, created_by FROM annotations
           WHERE label LIKE ? ESCAPE '\\'
             AND (provider_id IS NULL OR provider_id IN (${providerIds.map(() => "?").join(", ")}))
           ORDER BY at DESC, id DESC
           LIMIT ?`,
        )
        .all(term, ...providerIds, limit)
        .map((raw) => annotationRowSchema.parse(raw))
        .map((row) => ({
          id: row.id,
          at: row.at,
          label: row.label,
          colour: row.colour,
          providerId: row.provider_id,
          createdAt: row.created_at,
          createdBy: row.created_by,
        }));
    },

    async addIncidentNote(providerId: string, incidentId: string, body: string): Promise<IncidentNote> {
      const createdAt = now().toISOString();
      const { lastInsertRowid } = db
        .prepare(
          "INSERT INTO incident_notes (provider_id, incident_id, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(providerId, incidentId, body, createdAt);
      return { id: Number(lastInsertRowid), body, createdAt };
    },

    async followIncident(providerId: string, incidentId: string): Promise<void> {
      db.prepare(
        "INSERT OR IGNORE INTO incident_follows (provider_id, incident_id, followed_at) VALUES (?, ?, ?)",
      ).run(providerId, incidentId, now().toISOString());
    },

    async unfollowIncident(providerId: string, incidentId: string): Promise<void> {
      db.prepare("DELETE FROM incident_follows WHERE provider_id = ? AND incident_id = ?").run(providerId, incidentId);
    },

    async isIncidentFollowed(providerId: string, incidentId: string): Promise<boolean> {
      return (
        db
          .prepare("SELECT 1 AS one FROM incident_follows WHERE provider_id = ? AND incident_id = ?")
          .get(providerId, incidentId) !== undefined
      );
    },

    async deleteIncidentNote(providerId: string, incidentId: string, id: number): Promise<boolean> {
      // Scoped to the incident it was written on, not just to its own id: a
      // delete addressed through the wrong incident is a mistake, not a match.
      return (
        db
          .prepare("DELETE FROM incident_notes WHERE id = ? AND provider_id = ? AND incident_id = ?")
          .run(id, providerId, incidentId).changes > 0
      );
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

    async getDailyBuckets(providerId: string, segments: readonly DaySegment[]): Promise<DailyBucket[]> {
      const first = segments[0];
      const last = segments[segments.length - 1];
      return bucketsOver(segments, (segment) => {
        const rows: unknown[] = db
          .prepare(
            `SELECT date(observed_at, ?) AS day,
                    MAX(${RANK_CASE}) AS worst,
                    SUM(ok) AS ok_samples,
                    COUNT(*) AS total_samples
             FROM status_samples
             WHERE provider_id = ? AND observed_at >= ? AND observed_at < ?
             GROUP BY day`,
          )
          .all(shiftOf(segment), providerId, segment.fromIso, segment.toIso);
        // Roadmap 6.1: the days retention already rolled up, read once for the
        // whole window and folded in with the raw rows — a day pruned half way
        // has both, and bucketsOver sums them.
        if (segment === first && last !== undefined) {
          rows.push(
            ...db
              .prepare(
                `SELECT day, worst, ok_samples, total_samples FROM daily_rollups
                 WHERE provider_id = ? AND total_samples > 0 AND day >= date(?, ?) AND day < date(?, ?)`,
              )
              .all(providerId, segment.fromIso, shiftOf(segment), last.toIso, shiftOf(last)),
          );
        }
        return rows;
      });
    },

    async getComponentDailyBuckets(
      providerId: string,
      componentId: string,
      segments: readonly DaySegment[],
    ): Promise<DailyBucket[]> {
      return bucketsOver(segments, (segment) =>
        db
          .prepare(
            `SELECT date(observed_at, ?) AS day,
                    MAX(${rankCaseFor("status")}) AS worst,
                    SUM(ok) AS ok_samples,
                    COUNT(*) AS total_samples
             FROM component_samples
             WHERE provider_id = ? AND component_id = ? AND observed_at >= ? AND observed_at < ?
             GROUP BY day`,
          )
          .all(shiftOf(segment), providerId, componentId, segment.fromIso, segment.toIso),
      );
    },

    async recordPollCycle(cycle: PollCycle & { providers: number }): Promise<void> {
      insertPollCycle.run(
        cycle.startedAt,
        cycle.finishedAt,
        cycle.intervalMinutes,
        cycle.providers,
      );
    },

    async listPollCycles(fromIso: string, toIso: string): Promise<PollCycle[]> {
      return db
        .prepare(
          `SELECT started_at, finished_at, interval_minutes
           FROM poll_cycles WHERE started_at >= ? AND started_at < ? ORDER BY started_at ASC`,
        )
        .all(fromIso, toIso)
        .map((raw) => pollCycleRowSchema.parse(raw))
        .map((row) => ({
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          intervalMinutes: row.interval_minutes,
        }));
    },

    async listAnnotations(
      fromIso: string,
      toIso: string,
      providerId?: string | undefined,
    ): Promise<Annotation[]> {
      // The fleet-wide rows come back either way: a deploy is a marker on every
      // chart, and a provider view that hid it would be the one view where the
      // question "was it us?" cannot be answered.
      const where =
        providerId === undefined
          ? "at >= ? AND at < ?"
          : "at >= ? AND at < ? AND (provider_id IS NULL OR provider_id = ?)";
      const params = providerId === undefined ? [fromIso, toIso] : [fromIso, toIso, providerId];
      return db
        .prepare(`SELECT id, at, label, colour, provider_id, created_at, created_by FROM annotations WHERE ${where} ORDER BY at ASC, id ASC`)
        .all(...params)
        .map((raw) => annotationRowSchema.parse(raw))
        .map((row) => ({
          id: row.id,
          at: row.at,
          label: row.label,
          colour: row.colour,
          providerId: row.provider_id,
          createdAt: row.created_at,
          createdBy: row.created_by,
        }));
    },

    async addAnnotation(input: Omit<Annotation, "id" | "createdAt" | "createdBy"> & { createdBy?: string | null }): Promise<Annotation> {
      const createdAt = now().toISOString();
      const createdBy = input.createdBy ?? null;
      const { lastInsertRowid } = db
        .prepare("INSERT INTO annotations (at, label, colour, provider_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
        .run(input.at, input.label, input.colour, input.providerId, createdAt, createdBy);
      return { ...input, id: Number(lastInsertRowid), createdAt, createdBy };
    },

    async deleteAnnotation(id: number): Promise<boolean> {
      return db.prepare("DELETE FROM annotations WHERE id = ?").run(id).changes > 0;
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

    async getSamplesBetween(providerId: string, fromIso: string, toIso: string): Promise<SampleRow[]> {
      return db
        .prepare(
          `SELECT observed_at, overall_status, ok FROM status_samples
           WHERE provider_id = ? AND observed_at >= ? AND observed_at < ?
           ORDER BY observed_at, id`,
        )
        .all(providerId, fromIso, toIso)
        .map((raw) => sampleRowSchema.parse(raw))
        .map((row) => ({ observedAt: row.observed_at, overallStatus: row.overall_status, ok: row.ok === 1 }));
    },

    async getLatencySamples(providerId: string, sinceIso: string): Promise<{ observedAt: string; latencyMs: number }[]> {
      return db
        .prepare(
          `SELECT observed_at, latency_ms FROM status_samples
           WHERE provider_id = ? AND observed_at >= ? AND latency_ms IS NOT NULL
           ORDER BY observed_at`,
        )
        .all(providerId, sinceIso)
        .map((raw) => latencyRowSchema.parse(raw))
        .map((row) => ({ observedAt: row.observed_at, latencyMs: row.latency_ms }));
    },

    async pruneOlderThan(days: number): Promise<void> {
      const cutoff = new Date(now().getTime() - days * 24 * 3600 * 1000).toISOString();
      // Roadmap 6.1: retention is a resolution policy. What is about to go is
      // folded into its UTC day first, in the same transaction as the delete,
      // so a crash between the two can neither lose a day nor count it twice.
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO daily_rollups (provider_id, day, worst, ok_samples, total_samples, incidents)
           SELECT provider_id, date(observed_at), MAX(${RANK_CASE}), SUM(ok), COUNT(*), 0
           FROM status_samples WHERE observed_at < ? GROUP BY provider_id, date(observed_at)
           ON CONFLICT (provider_id, day) DO UPDATE SET
             worst = MAX(worst, excluded.worst),
             ok_samples = ok_samples + excluded.ok_samples,
             total_samples = total_samples + excluded.total_samples`,
        ).run(cutoff);
        db.prepare(
          `INSERT INTO daily_rollups (provider_id, day, worst, ok_samples, total_samples, incidents)
           SELECT provider_id, date(started_at), 0, 0, 0, COUNT(*)
           FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ? GROUP BY provider_id, date(started_at)
           ON CONFLICT (provider_id, day) DO UPDATE SET incidents = incidents + excluded.incidents`,
        ).run(cutoff);
        db.prepare("DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(cutoff);
        db.prepare("DELETE FROM status_samples WHERE observed_at < ?").run(cutoff);
        db.exec("COMMIT");
      } catch (error) {
        rollback(db);
        throw error;
      }
      db.prepare("DELETE FROM component_samples WHERE observed_at < ?").run(cutoff);
      db.prepare("DELETE FROM notifications WHERE sent_at < ?").run(cutoff);
      // On the same cutoff as the samples: a day whose samples are gone has no
      // chart left to hatch, and keeping its liveness would only grow.
      db.prepare("DELETE FROM poll_cycles WHERE started_at < ?").run(cutoff);
      db.prepare("DELETE FROM maintenances WHERE ends_at IS NOT NULL AND ends_at < ?").run(cutoff);
      // A chat message reference nobody has touched since the cutoff will not
      // be edited again: its resolution was swallowed (quiet hours, cap, mute).
      db.prepare("DELETE FROM message_refs WHERE updated_at < ?").run(cutoff);
      // Roadmap 1.11: an edit to an incident nobody keeps any more is a claim
      // about nothing. Read back from a feed that still carries it, the
      // incident simply starts a new first version.
      db.prepare("DELETE FROM incident_versions WHERE resolved_at < ?").run(cutoff);
      db.prepare(
        `DELETE FROM incident_revisions WHERE NOT EXISTS (
           SELECT 1 FROM incident_versions v
           WHERE v.provider_id = incident_revisions.provider_id AND v.incident_id = incident_revisions.incident_id)`,
      ).run();
    },

    async countRolledIncidents(providerId: string, fromDay: string, toDay: string): Promise<number> {
      const raw = db
        .prepare(
          "SELECT COALESCE(SUM(incidents), 0) AS total FROM daily_rollups WHERE provider_id = ? AND day >= ? AND day <= ?",
        )
        .get(providerId, fromDay, toDay);
      return z.object({ total: z.number() }).parse(raw).total;
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
        rollback(db);
        throw error;
      }
    },

    async close(): Promise<void> {
      if (db.isOpen) db.close();
    },
  };
}
