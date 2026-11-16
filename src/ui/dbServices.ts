/**
 * The `services` table: provider rows, their edits, and the soft delete that
 * leaves a removal restorable for a grace period.
 */

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  componentSelectionSchema,
  muteSchedulesSchema,
  operatorMaintenanceWindowsSchema,
  serviceDefinitionSchema,
} from "../core/config.schema.ts";
import { type ServiceDefinition } from "../core/configSource.interface.ts";
import { forgetProvider } from "../core/http.ts";

const serviceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  adapter: z.string(),
  base_url: z.string(),
  options: z.string().nullable(),
  enabled: z.number(),
  components: z.string().nullable(),
  scope_to_components: z.number(),
  favorite: z.number(),
  interval_minutes: z.number().nullable(),
  interval_seconds: z.number().nullable(),
  muted_until: z.string().nullable(),
  group_name: z.string().nullable(),
  depends_on: z.string().nullable(),
  cross_checks: z.string().nullable(),
  sla_target: z.number().nullable(),
  outage_cost_per_hour: z.number().nullable(),
  authority: z.enum(["declared", "observed"]).nullable(),
  impact: z.string().nullable(),
  owner: z.string().nullable(),
  runbook: z.string().nullable(),
  tags: z.string().nullable(),
  mute_schedules: z.string().nullable(),
  maintenance_windows: z.string().nullable(),
});

const removedRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  adapter: z.string(),
  base_url: z.string(),
  deleted_at: z.string(),
});

/** A provider removed but still restorable — `GET /config`'s `removed` list. */
export interface RemovedService {
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
  removedAt: string;
  /** When the grace period runs out and the cascade takes its history. */
  restoreUntil: string;
}

export function listServices(db: DatabaseSync): ServiceDefinition[] {
  return db
    .prepare(
      // A removed provider is invisible to everything that reads this: it stops
      // being polled, drops off the dashboard and out of every count, while its
      // history waits out the grace period.
      `SELECT id, name, adapter, base_url, options, enabled, components, scope_to_components, favorite, interval_minutes, interval_seconds, muted_until, group_name, depends_on, cross_checks, sla_target, outage_cost_per_hour, authority, impact, owner, runbook, tags, mute_schedules, maintenance_windows
       FROM services WHERE deleted_at IS NULL ORDER BY id`,
    )
    .all()
    .map((row) => serviceRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      baseUrl: row.base_url,
      enabled: row.enabled === 1,
      components:
        row.components === null
          ? []
          : componentSelectionSchema
              .catch([])
              .parse(JSON.parse(row.components)),
      scopeToComponents: row.scope_to_components === 1,
      ...(row.favorite === 1 ? { favorite: true } : {}),
      // Left off rather than passed as null: absent is what the poller reads as
      // "follow the global cadence".
      ...(row.interval_minutes === null
        ? {}
        : { intervalMinutes: row.interval_minutes }),
      ...(row.interval_seconds === null
        ? {}
        : { intervalSeconds: row.interval_seconds }),
      ...(row.options === null
        ? {}
        : { options: JSON.parse(row.options) as Record<string, string> }),
      // Absent rather than null for the same reason as the interval: the
      // engine reads "no mute" from the field not being there, and an expired
      // mute is dropped here so nothing downstream has to know today's date to
      // tell a live mute from a spent one.
      ...(row.muted_until === null || Date.parse(row.muted_until) <= Date.now()
        ? {}
        : { mutedUntil: row.muted_until }),
      // Absent rather than null, like the interval above: "in no group" is the
      // normal state and the engine reads it from the field not being there.
      ...(row.group_name === null ? {} : { group: row.group_name }),
      ...(row.depends_on === null
        ? {}
        : {
            dependsOn: z
              .array(z.string())
              .catch([])
              .parse(JSON.parse(row.depends_on)),
          }),
      ...(row.cross_checks === null ? {} : { crossChecks: row.cross_checks }),
      // Absent rather than null, like every optional above: "nobody promised
      // anything about this provider" has to stay distinguishable from a
      // target that happens to be 100 (roadmap 4.13).
      ...(row.sla_target === null ? {} : { slaTarget: row.sla_target }),
      ...(row.outage_cost_per_hour === null ? {} : { outageCostPerHour: row.outage_cost_per_hour }),
      ...(row.authority === null ? {} : { authority: row.authority }),
      // Absent rather than null, like every optional above (roadmap 3.7).
      ...(row.impact === null ? {} : { impact: row.impact }),
      ...(row.owner === null ? {} : { owner: row.owner }),
      // Roadmap 5.1–5.4, absent rather than null like every optional above. A
      // list that no longer parses reads as no list: a planned mute that cannot
      // be read must lose to the alert, never silence it.
      ...(row.runbook === null ? {} : { runbook: row.runbook }),
      ...jsonColumn("tags", row.tags, serviceDefinitionSchema.shape.tags.unwrap()),
      ...jsonColumn("muteSchedules", row.mute_schedules, muteSchedulesSchema),
      ...jsonColumn("maintenanceWindows", row.maintenance_windows, operatorMaintenanceWindowsSchema),
    }));
}

/** A JSON list column as the optional field it stores, or nothing when empty or unreadable. */
function jsonColumn<K extends string, T>(
  key: K,
  value: string | null,
  schema: z.ZodType<T[], z.ZodTypeDef, unknown>,
): Partial<Record<K, T[]>> {
  if (value === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return {};
  }
  const parsed = schema.safeParse(raw);
  return parsed.success && parsed.data.length > 0 ? ({ [key]: parsed.data } as Partial<Record<K, T[]>>) : {};
}

/** A list as its column: null for none, so an emptied list reads back as absent. */
const listColumn = (list: readonly unknown[] | null | undefined): string | null =>
  list === null || list === undefined || list.length === 0 ? null : JSON.stringify(list);

export function insertService(
  db: DatabaseSync,
  definition: ServiceDefinition,
): void {
  const parsed = serviceDefinitionSchema.parse(definition);
  db.prepare(
    "INSERT INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, favorite, interval_minutes, interval_seconds, muted_until, group_name, depends_on, cross_checks, sla_target, outage_cost_per_hour, authority, impact, owner, runbook, tags, mute_schedules, maintenance_windows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    parsed.id,
    parsed.name,
    parsed.adapter,
    parsed.baseUrl,
    parsed.options === undefined ? null : JSON.stringify(parsed.options),
    parsed.enabled ? 1 : 0,
    parsed.components.length === 0 ? null : JSON.stringify(parsed.components),
    parsed.scopeToComponents ? 1 : 0,
    parsed.favorite === true ? 1 : 0,
    parsed.intervalMinutes ?? null,
    parsed.intervalSeconds ?? null,
    parsed.mutedUntil ?? null,
    parsed.group ?? null,
    parsed.dependsOn === undefined ? null : JSON.stringify(parsed.dependsOn),
    parsed.crossChecks ?? null,
    parsed.slaTarget ?? null,
    parsed.outageCostPerHour ?? null,
    parsed.authority ?? null,
    parsed.impact ?? null,
    parsed.owner ?? null,
    parsed.runbook ?? null,
    listColumn(parsed.tags),
    listColumn(parsed.muteSchedules),
    listColumn(parsed.maintenanceWindows),
    new Date().toISOString(),
  );
}

/**
 * Null is how the dashboard puts a provider back on the global cadence.
 * `undefined` cannot say it: on a patch it means "leave this alone", so
 * clearing an interval needs a value of its own.
 */
export const servicePatchSchema = serviceDefinitionSchema
  .partial()
  .omit({ id: true })
  .extend({
    intervalMinutes: z
      .number()
      .int()
      .positive()
      .max(1440)
      .nullable()
      .optional(),
    /** Null puts a probe back on the minute cadence (roadmap 1.6). */
    intervalSeconds: serviceDefinitionSchema.shape.intervalSeconds
      .unwrap()
      .nullable()
      .optional(),
    // Null is how the dashboard lifts a mute early, for the same reason: on a
    // patch `undefined` already means "leave it alone".
    mutedUntil: z.string().datetime().nullable().optional(),
    /** Null takes the provider out of its group (roadmap 2.6). */
    group: serviceDefinitionSchema.shape.group.unwrap().nullable().optional(),
    /** Null clears what the provider runs on (roadmap 2.9). */
    dependsOn: serviceDefinitionSchema.shape.dependsOn
      .unwrap()
      .nullable()
      .optional(),
    /** Null stops a probe cross-checking anything (roadmap 1.10). */
    crossChecks: serviceDefinitionSchema.shape.crossChecks
      .unwrap()
      .nullable()
      .optional(),
    /** Null means nobody is promising anything about this provider any more (roadmap 4.13). */
    slaTarget: serviceDefinitionSchema.shape.slaTarget
      .unwrap()
      .nullable()
      .optional(),
    /** Null drops the declared cost of an hour of downtime (roadmap 6.3). */
    outageCostPerHour: serviceDefinitionSchema.shape.outageCostPerHour
      .unwrap()
      .nullable()
      .optional(),
    /** Null clears why the provider matters, or who answers for it (roadmap 3.7). */
    impact: serviceDefinitionSchema.shape.impact.unwrap().nullable().optional(),
    owner: serviceDefinitionSchema.shape.owner.unwrap().nullable().optional(),
    /** Null clears the runbook, the tags, the planned mutes or the declared windows (roadmap 5.1–5.4). */
    runbook: serviceDefinitionSchema.shape.runbook.unwrap().nullable().optional(),
    tags: serviceDefinitionSchema.shape.tags.unwrap().nullable().optional(),
    muteSchedules: muteSchedulesSchema.nullable().optional(),
    maintenanceWindows: operatorMaintenanceWindowsSchema.nullable().optional(),
  });

/** Returns false when there was no such service, so a route can answer 404. */
export function updateService(
  db: DatabaseSync,
  id: string,
  patch: z.input<typeof servicePatchSchema>,
): boolean {
  const parsed = servicePatchSchema.parse(patch);
  const columns: Record<string, string | number | null> = {};
  if (parsed.name !== undefined) columns["name"] = parsed.name;
  if (parsed.adapter !== undefined) columns["adapter"] = parsed.adapter;
  if (parsed.baseUrl !== undefined) columns["base_url"] = parsed.baseUrl;
  if (parsed.enabled !== undefined) columns["enabled"] = parsed.enabled ? 1 : 0;
  if (parsed.options !== undefined)
    columns["options"] = JSON.stringify(parsed.options);
  // Null is how the dashboard takes a provider out of its group, the way it
  // clears an interval: on a patch `undefined` already means "leave it alone".
  if (parsed.group !== undefined) columns["group_name"] = parsed.group;
  if (parsed.dependsOn !== undefined)
    columns["depends_on"] =
      parsed.dependsOn === null ? null : JSON.stringify(parsed.dependsOn);
  if (parsed.crossChecks !== undefined)
    columns["cross_checks"] = parsed.crossChecks;
  if (parsed.components !== undefined) {
    columns["components"] =
      parsed.components.length === 0 ? null : JSON.stringify(parsed.components);
  }
  if (parsed.scopeToComponents !== undefined) {
    columns["scope_to_components"] = parsed.scopeToComponents ? 1 : 0;
  }
  if (parsed.favorite !== undefined) columns["favorite"] = parsed.favorite ? 1 : 0;
  if (parsed.intervalMinutes !== undefined)
    columns["interval_minutes"] = parsed.intervalMinutes;
  if (parsed.intervalSeconds !== undefined)
    columns["interval_seconds"] = parsed.intervalSeconds;
  // One cadence at a time (roadmap 1.6): naming one clears the other, so a
  // probe moved from seconds back to minutes cannot keep both and have the
  // seconds silently win.
  if (typeof parsed.intervalMinutes === "number" && parsed.intervalSeconds === undefined)
    columns["interval_seconds"] = null;
  if (typeof parsed.intervalSeconds === "number" && parsed.intervalMinutes === undefined)
    columns["interval_minutes"] = null;
  if (parsed.mutedUntil !== undefined)
    columns["muted_until"] = parsed.mutedUntil;
  if (parsed.slaTarget !== undefined) columns["sla_target"] = parsed.slaTarget;
  if (parsed.outageCostPerHour !== undefined) columns["outage_cost_per_hour"] = parsed.outageCostPerHour;
  if (parsed.authority !== undefined) columns["authority"] = parsed.authority;
  if (parsed.impact !== undefined) columns["impact"] = parsed.impact;
  if (parsed.owner !== undefined) columns["owner"] = parsed.owner;
  if (parsed.runbook !== undefined) columns["runbook"] = parsed.runbook;
  if (parsed.tags !== undefined) columns["tags"] = listColumn(parsed.tags);
  if (parsed.muteSchedules !== undefined) columns["mute_schedules"] = listColumn(parsed.muteSchedules);
  if (parsed.maintenanceWindows !== undefined)
    columns["maintenance_windows"] = listColumn(parsed.maintenanceWindows);
  if (Object.keys(columns).length === 0) return exists(db, id);

  const assignments = Object.keys(columns)
    .map((column) => `${column} = ?`)
    .join(", ");
  // A removed provider is on its way out: editing it back into service through
  // a patch would be an update nothing on the dashboard could see.
  const result = db
    .prepare(
      `UPDATE services SET ${assignments} WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(...Object.values(columns), id);
  return result.changes > 0;
}

export interface ServiceImpact {
  samples: number;
  componentSamples: number;
  incidents: number;
  maintenances: number;
  routingRules: number;
  historyDays: number;
}

/**
 * What removing a provider will eventually take with it. Read-only, and deliberately next to
 * the delete it describes: the cascade lives in the schema, so the only way the
 * two stay in step is for a new `ON DELETE CASCADE` table to be visible from
 * here when it is added.
 *
 * Returns null for an unknown id, like `updateService` returns false, so the
 * route can answer 404 rather than a confident row of zeros.
 *
 * Rules naming "*" are not counted: they survive the removal (see
 * `purgeService`), and a confirmation that claims otherwise is worse than one
 * that says nothing.
 */
export function describeServiceImpact(
  db: DatabaseSync,
  id: string,
): ServiceImpact | null {
  if (!exists(db, id)) return null;
  const count = (sql: string, ...extra: string[]): number =>
    z.object({ n: z.number() }).parse(db.prepare(sql).get(id, ...extra)).n;
  // A component rule names this provider too (roadmap 2.9). A service id is a
  // lowercase slug by schema, so it can carry no LIKE wildcard of its own.
  const componentRules = `${id}#%`;
  const oldest = z
    .object({ oldest: z.string().nullable() })
    .parse(
      db
        .prepare(
          "SELECT MIN(observed_at) AS oldest FROM status_samples WHERE provider_id = ?",
        )
        .get(id),
    ).oldest;
  const oldestMs = oldest === null ? null : Date.parse(oldest);
  return {
    samples: count(
      "SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = ?",
    ),
    componentSamples: count(
      "SELECT COUNT(*) AS n FROM component_samples WHERE provider_id = ?",
    ),
    incidents: count(
      "SELECT COUNT(*) AS n FROM incidents WHERE provider_id = ?",
    ),
    maintenances: count(
      "SELECT COUNT(*) AS n FROM maintenances WHERE provider_id = ?",
    ),
    // Its own rules and its components' (roadmap 2.9): `github#api` names this
    // provider as surely as `github` does, and a removal takes both.
    routingRules: count(
      "SELECT COUNT(*) AS n FROM routing_rules WHERE provider = ? OR provider LIKE ?",
      componentRules,
    ),
    // Rounded up: a provider polled for an hour has lost "a day of history",
    // not zero. An unparseable timestamp counts as no history rather than NaN.
    historyDays:
      oldestMs === null || Number.isNaN(oldestMs)
        ? 0
        : Math.ceil((Date.now() - oldestMs) / 86_400_000),
  };
}

/**
 * How long a removed provider can be brought back. Long enough to survive a
 * weekend — the mistake this exists for is noticed when somebody looks for a
 * chart that is gone, not in the ten seconds a toast lasts.
 */
export const RESTORE_WINDOW_DAYS = 7;

/** When the grace period on a removal runs out. */
export const restoreDeadline = (deletedAt: string): string =>
  new Date(
    Date.parse(deletedAt) + RESTORE_WINDOW_DAYS * 86_400_000,
  ).toISOString();

/**
 * Marks a provider removed without taking anything with it yet. It leaves the
 * dashboard and the poll cycle immediately — `listServices` is the one thing
 * both read — while its history sits untouched until the grace period expires.
 *
 * Returns false for an id that is not there or is already removed, so a route
 * can answer 404 and a second click cannot restart the clock.
 */
export function softDeleteService(
  db: DatabaseSync,
  id: string,
  at: Date = new Date(),
): boolean {
  return (
    db
      .prepare(
        "UPDATE services SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(at.toISOString(), id).changes > 0
  );
}

/** Puts a removed provider back, history and rules included — nothing was taken. */
export function restoreService(db: DatabaseSync, id: string): boolean {
  return (
    db
      .prepare(
        "UPDATE services SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL",
      )
      .run(id).changes > 0
  );
}

/** Every removed provider still inside its grace period, oldest removal last. */
export function listRemovedServices(db: DatabaseSync): RemovedService[] {
  return db
    .prepare(
      "SELECT id, name, adapter, base_url, deleted_at FROM services WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )
    .all()
    .map((row) => removedRowSchema.parse(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      adapter: row.adapter,
      baseUrl: row.base_url,
      removedAt: row.deleted_at,
      restoreUntil: restoreDeadline(row.deleted_at),
    }));
}

/**
 * Takes every removal whose grace period has run out. This is where the cascade
 * finally happens, so it is the one path that actually destroys history —
 * called on boot and on the same daily timer that prunes old samples.
 *
 * Returns the ids it took, for the log line: a deletion nobody asked for today
 * should still be traceable to the removal that scheduled it.
 */
export function purgeExpiredServices(
  db: DatabaseSync,
  at: Date = new Date(),
): string[] {
  const cutoff = new Date(
    at.getTime() - RESTORE_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const expired = db
    .prepare(
      "SELECT id FROM services WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
    )
    .all(cutoff)
    .map((row) => z.object({ id: z.string() }).parse(row).id);
  for (const id of expired) purgeService(db, id);
  return expired;
}

/**
 * The hard delete, cascade and all. Reachable two ways: the grace period
 * expiring, and an operator saying "remove it now" — the same code either way,
 * because a purge that behaved differently depending on who asked would be a
 * second deletion path to keep in step.
 */
export function purgeService(db: DatabaseSync, id: string): boolean {
  const deleted =
    db.prepare("DELETE FROM services WHERE id = ?").run(id).changes > 0;
  if (deleted) {
    // Nothing cached for a provider that no longer exists — a re-added id must
    // not be revalidated against the validator of the one that is gone.
    forgetProvider(id);
    // No FK could do this: "*" is not a service id. A rule left naming a deleted
    // provider would match nothing and quietly sit in the list forever. Only
    // when a row actually went away — a 404 on an unknown id must not mutate.
    // Its components' rules go with it: `github#api` names this provider as
    // surely as `github` does (roadmap 2.9).
    db.prepare(
      "DELETE FROM routing_rules WHERE provider = ? OR provider LIKE ?",
    ).run(id, `${id}#%`);
  }
  return deleted;
}

const exists = (db: DatabaseSync, id: string): boolean =>
  db
    .prepare(
      "SELECT 1 AS one FROM services WHERE id = ? AND deleted_at IS NULL",
    )
    .get(id) !== undefined;
