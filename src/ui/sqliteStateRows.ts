/**
 * What the SQLite state store reads back and how: the row schemas every query
 * result is validated against, the severity ranking the daily buckets are built
 * on, and the small SQL helpers its queries share. Split from
 * `sqliteStateStore.ts` (roadmap 13.12), which keeps the statements and the
 * store itself.
 */
import { z } from "zod";
import type { DaySegment } from "./calendarDays.ts";
import type { SentRecord } from "../core/dispatcher.interface.ts";
import type { ProviderRuntimeState } from "../core/stateStore.interface.ts";
import { componentStatusSchema, incidentSchema, maintenanceWindowSchema, suspicionSchema, freshnessSchema } from "../core/status.schema.ts";
import { STATUS_CHANGE_KINDS } from "../core/types.ts";
import type { OverallStatus } from "../core/types.ts";
import { ANNOTATION_COLOURS } from "./historyStore.interface.ts";
import type { DailyBucket, IncidentRow, MaintenanceRow } from "./historyStore.interface.ts";

export const incidentsColumnSchema = z.array(incidentSchema);
export const componentsColumnSchema = z.array(componentStatusSchema);
export const maintenancesColumnSchema = z.array(maintenanceWindowSchema);
export const suspicionsColumnSchema = z.array(suspicionSchema);
export const freshnessColumnSchema = freshnessSchema.nullable();

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

export const stateRowSchema = z.object({
  overall_status: overallStatusSchema,
  active_incidents: z.string(),
  components: z.string(),
  maintenances: z.string(),
  fetched_at: z.string(),
  failure_count: z.number(),
  degraded_notified: z.number(),
  // Written by the notification gate, and null on every row that predates it.
  notify_baseline: z.string().nullable(),
  pending_signature: z.string().nullable(),
  pending_count: z.number(),
  suspicions: z.string(),
  freshness: z.string().nullable(),
});

export const incidentRowSchema = z.object({
  provider_id: z.string(),
  incident_id: z.string(),
  name: z.string(),
  impact: z.string(),
  status: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
  declared_at: z.string().nullable(),
  first_seen_at: z.string().nullable(),
});

export const annotationRowSchema = z.object({
  id: z.number(),
  at: z.string(),
  label: z.string(),
  colour: z.enum(ANNOTATION_COLOURS),
  provider_id: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string().nullable(),
});

export const incidentNoteRowSchema = z.object({
  id: z.number(),
  body: z.string(),
  created_at: z.string(),
});

export const incidentNoteHitRowSchema = incidentNoteRowSchema.extend({
  provider_id: z.string(),
  incident_id: z.string(),
  incident_name: z.string().nullable(),
});

export const latencyRowSchema = z.object({ observed_at: z.string(), latency_ms: z.number() });

export const maintenanceRowSchema = z.object({
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
export const incidentCountsSchema = z.object({
  all_count: z.number(),
  active_count: z.number().nullable().transform((value) => value ?? 0),
});

/** `SUM(...)` is NULL, not 0, when no send matches the WHERE clause. */
export const notificationCountsSchema = z.object({
  all_count: z.number(),
  sent_count: z.number().nullable().transform((value) => value ?? 0),
});

export const notificationRowSchema = z.object({
  id: z.number(),
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
  /**
   * Coerced with a fallback rather than required: the column arrived with
   * retries (roadmap 3.14) and a row written before the migration reads back
   * as one attempt, which is what it was.
   */
  attempts: z.coerce.number().int().positive().catch(1),
});

const bucketRowSchema = z.object({
  day: z.string(),
  worst: z.number(),
  ok_samples: z.number(),
  total_samples: z.number(),
});

export const pollCycleRowSchema = z.object({
  started_at: z.string(),
  finished_at: z.string(),
  interval_minutes: z.number(),
});

export const sampleRowSchema = z.object({
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

export const rankCaseFor = (column: string): string =>
  `CASE ${column} ${Object.entries(SEVERITY_RANK)
    .map(([status, rank]) => `WHEN '${status}' THEN ${rank}`)
    .join(" ")} ELSE ${SEVERITY_RANK.major_outage} END`;
export const RANK_CASE = rankCaseFor("overall_status");

/**
 * The SQLite date modifier that turns a stored UTC instant into the operator's
 * wall clock for a stretch where one offset holds — roadmap 10.7. `date()` then
 * reads the local calendar day off it.
 */
export const shiftOf = (segment: DaySegment): string => `${segment.offsetMinutes >= 0 ? "+" : ""}${segment.offsetMinutes} minutes`;

/**
 * Runs one grouped query per constant-offset stretch and folds the results into
 * one series.
 *
 * Folded rather than concatenated because the day a DST transition falls on is
 * counted from both sides of the seam: two rows for one day, which have to be
 * summed, or the day would appear twice and every figure drawn from it would be
 * taken over half of it.
 */
export function bucketsOver(
  segments: readonly DaySegment[],
  query: (segment: DaySegment) => unknown[],
): DailyBucket[] {
  const byDay = new Map<string, DailyBucket>();
  for (const segment of segments) {
    for (const raw of query(segment)) {
      const row = bucketRowSchema.parse(raw);
      const status = RANK_TO_STATUS[row.worst] ?? "unknown";
      const existing = byDay.get(row.day);
      if (existing === undefined) {
        byDay.set(row.day, {
          day: row.day,
          worstStatus: status,
          okSamples: row.ok_samples,
          totalSamples: row.total_samples,
        });
        continue;
      }
      existing.okSamples += row.ok_samples;
      existing.totalSamples += row.total_samples;
      if (SEVERITY_RANK[status] > SEVERITY_RANK[existing.worstStatus]) existing.worstStatus = status;
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * A provider's own timestamp is untrusted input like the rest of its payload.
 * One ahead of our clock would make the incident resolve "before" it started and
 * every duration derived from it negative, so the start time is pinned to when we
 * first observed the incident. The provider's own claim is still kept as
 * `updated_at`.
 */
export function startedAt(providerUpdatedAt: string, observedAt: string): string {
  const claimed = Date.parse(providerUpdatedAt);
  const observed = Date.parse(observedAt);
  if (Number.isNaN(claimed) || claimed > observed) return observedAt;
  return providerUpdatedAt;
}

export const baseline = (): ProviderRuntimeState => ({
  last: null,
  failureCount: 0,
  degradedNotified: false,
  notifyBaseline: null,
  pending: null,
  suspicions: [],
  freshness: null,
});

export const toIncidentRow = (row: IncidentDbRow): IncidentRow => ({
  providerId: row.provider_id,
  incidentId: row.incident_id,
  name: row.name,
  impact: row.impact,
  status: row.status,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
  ...(row.declared_at === null ? {} : { declaredAt: row.declared_at }),
  ...(row.first_seen_at === null ? {} : { firstSeenAt: row.first_seen_at }),
});

export const toMaintenanceRow = (row: MaintenanceDbRow): MaintenanceRow => ({
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

/** One `notifications` row as the dispatcher's own record. */
export function toSentRecord(row: z.infer<typeof notificationRowSchema>): SentRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    channel: row.channel,
    kind: row.kind,
    text: row.text,
    sentAt: row.sent_at,
    ok: row.ok === 1,
    attempts: row.attempts,
    ...(row.error === null ? {} : { error: row.error }),
  };
}

/**
 * A `provider_id` allow-list as a clause and its parameters, or null when the
 * caller asked for no restriction at all.
 *
 * An empty list becomes `1 = 0` rather than nothing: SQLite rejects `IN ()`,
 * and "every provider is disabled" has to match no rows instead of falling
 * through to all of them.
 */
export function providerScope(
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
 * A free-text search as a `LIKE` pattern, or undefined when the caller asked for
 * no search. `%` and `_` are the wildcards of the pattern language itself, so an
 * operator searching for "50% errors" is searching for that text rather than
 * accidentally matching everything; `\\` is the escape character the clause
 * declares.
 */
export function likeTerm(query: string | undefined): string | undefined {
  const trimmed = query?.trim() ?? "";
  if (trimmed === "") return undefined;
  return `%${trimmed.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
