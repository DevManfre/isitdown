import { statfsSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getAdapter, registerAdapter } from "../adapters/index.ts";
import type { Adapter, ComponentPreview, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import { t } from "../core/i18n/index.ts";
import type { Logger } from "../core/logger.ts";
import type { ComponentStatus, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { rollback } from "./db/open.ts";
import { readSettings } from "./dbSettings.ts";
import { readBackupState } from "./backupSchedule.ts";
import { SELF_MONITOR_ID } from "./selfMonitorId.ts";

/**
 * IsItDown watching IsItDown — roadmap 10.6.
 *
 * Cycles that slip, adapters that keep failing, messages that never arrived
 * and a disk running out were all visible only in `/metrics`, which nobody
 * reads until something is already wrong. This adapter reads the same state
 * and reports it as a status page would, so the instance is one more provider:
 * a row on the Overview, a history, and a change that goes through the diff
 * engine and the notifiers like any other — routing, quiet hours and the
 * digest included. Nothing here sends anything.
 *
 * It lives in the edition layer because what it reads only exists here: the
 * poll-cycle ledger, the delivery log and the database file. It complements
 * 10.5's heartbeat, which notices the instance *stopped*; this one notices it
 * running badly.
 */

/** The components the instance reports, in the order a reader takes them in. */
export const SELF_COMPONENTS = ["polling", "adapters", "notifications", "database"] as const;
export type SelfComponent = (typeof SELF_COMPONENTS)[number];

/** Gaps longer than this many intervals mean a cycle did not run. */
export const MISSED_CYCLE_FACTOR = 2;
/** This many cycles in a row taking over half their interval is a poller falling behind. */
export const SLOW_CYCLE_RUN = 3;
/** How far back a failed delivery still counts against Notifications. */
export const FAILED_DELIVERY_WINDOW_MS = 24 * 3_600_000;
/** Free space under the database below which a full disk is the next incident. */
export const LOW_DISK_BYTES = 256 * 1024 * 1024;

export interface SelfSignals {
  now: number;
  /** When this process started: a gap from before it is a restart, which 10.5 sees, not a slip. */
  bootedAt: number;
  /** The poll-cycle ledger's latest rows, newest first. */
  cycles: { startedAt: string; finishedAt: string; intervalMinutes: number }[];
  /** Every other enabled provider's consecutive failed fetches. */
  providers: { id: string; failureCount: number }[];
  /** `failureThreshold`: the same count that makes a provider's own view "monitoring degraded". */
  failureThreshold: number;
  /** Deliveries that failed for good within `FAILED_DELIVERY_WINDOW_MS`. */
  failedDeliveries: number;
  /** Free bytes on the database's filesystem; null when there is no file to measure. */
  freeBytes: number | null;
  /**
   * Why the latest scheduled backup failed (roadmap 10.1); null or absent while
   * it worked or none ran. A failed backup reaches the operator as this
   * finding — through the diff engine, like every other alert.
   */
  backupError?: string | null;
}

export interface SelfFinding {
  component: SelfComponent;
  /** Why, in the debug panel's words — a machine-facing note, like the heartbeat's. */
  note: string;
}

/**
 * The rules, apart from where their inputs come from, so they can be held to
 * a table. A component with no finding is operational; one with a finding is
 * degraded — the instance is still answering, so nothing here is ever an outage.
 */
export function selfFindings(signals: SelfSignals): SelfFinding[] {
  const findings: SelfFinding[] = [];
  const [latest] = signals.cycles;

  if (latest !== undefined && Date.parse(latest.startedAt) >= signals.bootedAt) {
    const gapMs = signals.now - Date.parse(latest.startedAt);
    if (gapMs > MISSED_CYCLE_FACTOR * latest.intervalMinutes * 60_000) {
      findings.push({
        component: "polling",
        note: `no poll cycle for ${Math.round(gapMs / 60_000)}m, expected every ${latest.intervalMinutes}m`,
      });
    }
  }
  const run = signals.cycles.slice(0, SLOW_CYCLE_RUN);
  const slow = (cycle: SelfSignals["cycles"][number]): boolean =>
    Date.parse(cycle.finishedAt) - Date.parse(cycle.startedAt) > (cycle.intervalMinutes * 60_000) / 2;
  if (run.length === SLOW_CYCLE_RUN && run.every(slow)) {
    findings.push({
      component: "polling",
      note: `the last ${SLOW_CYCLE_RUN} cycles each took over half their interval`,
    });
  }

  const failing = signals.providers.filter((provider) => provider.failureCount >= signals.failureThreshold);
  if (failing.length > 0) {
    findings.push({
      component: "adapters",
      note: `failing ${signals.failureThreshold}+ times in a row: ${failing.map((provider) => provider.id).join(", ")}`,
    });
  }

  if (signals.failedDeliveries > 0) {
    findings.push({
      component: "notifications",
      note: `${signals.failedDeliveries} notification(s) failed for good in the last 24h`,
    });
  }

  if (signals.freeBytes !== null && signals.freeBytes < LOW_DISK_BYTES) {
    findings.push({
      component: "database",
      note: `${Math.round(signals.freeBytes / 1024 / 1024)} MiB free beside the database`,
    });
  }

  if (signals.backupError !== undefined && signals.backupError !== null) {
    findings.push({ component: "database", note: `scheduled backup failed: ${signals.backupError}` });
  }

  return findings;
}

/** A component's status from the findings: degraded with any, operational with none. */
export function componentStatus(findings: SelfFinding[], component: SelfComponent): OverallStatus {
  return findings.some((finding) => finding.component === component) ? "degraded" : "operational";
}

const cycleRow = z.object({ started_at: z.string(), finished_at: z.string(), interval_minutes: z.number() });
const providerRow = z.object({ id: z.string(), failure_count: z.number() });
const countRow = z.object({ n: z.number() });

interface Binding {
  db: DatabaseSync;
  dbPath: string;
  logger: Logger;
  bootedAt: number;
}

/**
 * The runtime the registered adapter reads. Process-wide like the adapter
 * registry, the same way the heartbeat ledger is: one UI runtime per process
 * in production, and a test that builds a second one rebinds it.
 */
let current: Binding | null = null;

function freeBytes(dbPath: string): number | null {
  if (dbPath === ":memory:") return null;
  const stats = statfsSync(dirname(dbPath));
  return stats.bavail * stats.bsize;
}

export function readSelfSignals(binding: Binding, now: number): SelfSignals {
  const { db } = binding;
  return {
    now,
    bootedAt: binding.bootedAt,
    cycles: db
      .prepare(
        `SELECT started_at, finished_at, interval_minutes FROM poll_cycles ORDER BY started_at DESC LIMIT ${SLOW_CYCLE_RUN}`,
      )
      .all()
      .map((raw) => cycleRow.parse(raw))
      .map((row) => ({ startedAt: row.started_at, finishedAt: row.finished_at, intervalMinutes: row.interval_minutes })),
    providers: db
      .prepare(
        `SELECT s.id, p.failure_count FROM services s JOIN provider_state p ON p.provider_id = s.id
         WHERE s.enabled = 1 AND s.deleted_at IS NULL AND s.adapter != ?`,
      )
      .all(SELF_MONITOR_ID)
      .map((raw) => providerRow.parse(raw))
      .map((row) => ({ id: row.id, failureCount: row.failure_count })),
    failureThreshold: readSettings(db, binding.logger).failureThreshold,
    failedDeliveries: countRow.parse(
      db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE ok = 0 AND sent_at >= ?")
        .get(new Date(now - FAILED_DELIVERY_WINDOW_MS).toISOString()),
    ).n,
    freeBytes: freeBytes(binding.dbPath),
    backupError: readBackupState(db).lastError,
  };
}

/** Component names in the language notifications are written in, read per poll like the setting itself. */
function componentNames(binding: Binding): Record<SelfComponent, string> {
  const locale = readSettings(binding.db, binding.logger).notificationLocale;
  return Object.fromEntries(
    SELF_COMPONENTS.map((component) => [component, t(locale, `self-monitor.component.${component}`)]),
  ) as Record<SelfComponent, string>;
}

export const selfMonitorAdapter: Adapter = {
  id: SELF_MONITOR_ID,
  version: 1,
  // Our own observation, not a page somebody publishes.
  kind: "probe",

  async listComponents(): Promise<ComponentPreview[]> {
    if (current === null) return [];
    const names = componentNames(current);
    return SELF_COMPONENTS.map((id) => ({ id, name: names[id], group: null, showcase: true, status: "operational" }));
  },

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    if (current === null) throw new Error(`${service.id}: the instance monitor only runs in the UI edition`);
    const now = Date.now();
    const findings = selfFindings(readSelfSignals(current, now));
    for (const finding of findings) ctx.onNote?.({ text: `${finding.component}: ${finding.note}` });

    const names = componentNames(current);
    // The operator's selection, as every adapter honours it: a component taken
    // off the row stops being reported, and so stops being notified about.
    const components: ComponentStatus[] = (service.components ?? [])
      .filter((selection): selection is { id: SelfComponent; name: string } =>
        (SELF_COMPONENTS as readonly string[]).includes(selection.id),
      )
      .map((selection) => ({
        id: selection.id,
        name: names[selection.id],
        status: componentStatus(findings, selection.id),
      }));

    return {
      provider: service.id,
      overallStatus: findings.length > 0 ? "degraded" : "operational",
      activeIncidents: [],
      components,
      maintenances: [],
      fetchedAt: new Date(now).toISOString(),
    };
  },
};

/** Binds the adapter to this runtime's database, registering it on first use. */
export function useSelfMonitor(db: DatabaseSync, dbPath: string, logger: Logger): void {
  current = { db, dbPath, logger, bootedAt: Date.now() };
  let registered = true;
  try {
    getAdapter(SELF_MONITOR_ID);
  } catch {
    registered = false;
  }
  if (!registered) registerAdapter(selfMonitorAdapter);
}

/** Never fetched: `.invalid` cannot resolve (RFC 2606), as the heartbeat's own base URL. */
export const SELF_MONITOR_BASE_URL = "https://self.invalid";

/**
 * Adds the instance's row once per installation — new ones and upgraded ones
 * alike. A marker setting, not the row's presence, says it was done: an
 * operator who removes the row has answered, and a restart must not ask again.
 */
export function seedSelfMonitor(db: DatabaseSync, logger: Logger): void {
  const marker = db.prepare("SELECT value FROM settings WHERE key = 'selfMonitorSeeded'").get();
  if (marker !== undefined) return;
  const locale = readSettings(db, logger).notificationLocale;
  const components = SELF_COMPONENTS.map((id) => ({ id, name: t(locale, `self-monitor.component.${id}`) }));
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT OR IGNORE INTO services (id, name, adapter, base_url, options, enabled, components, scope_to_components, created_at)
       VALUES (?, 'IsItDown', ?, ?, NULL, 1, ?, 0, ?)`,
    ).run(SELF_MONITOR_ID, SELF_MONITOR_ID, SELF_MONITOR_BASE_URL, JSON.stringify(components), new Date().toISOString());
    db.prepare("INSERT INTO settings (key, value) VALUES ('selfMonitorSeeded', 'true')").run();
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}
