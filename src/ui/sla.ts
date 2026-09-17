import type { DatabaseSync } from "node:sqlite";
import type { ServiceDefinition } from "../core/configSource.interface.ts";
import { slaBurn } from "../core/diffEngine.ts";
import type { StatusChange } from "../core/types.ts";
import type { createHistoryService } from "./history.ts";

/**
 * Per-provider SLA target and error budget — roadmap 4.13.
 *
 * The samples were already stored; what was missing was the question. A 90-day
 * uptime figure answers "how has this vendor been", and the question somebody
 * actually has to answer in a review is "does this vendor meet what we were
 * promised, this month". That is a different shape: a target, the downtime
 * budget it implies, how much of it the month has spent, and — the only part
 * that is not arithmetic on the past — whether the rate says the month will
 * miss.
 *
 * A calendar month rather than a rolling window, because that is the unit an
 * SLA is written in. It reads the same monthly report the Markdown export and
 * the History view are drawn from, so a budget can never disagree with the
 * uptime printed beside it.
 *
 * The *decision* to alert is `slaBurn` in the diff engine, not here: this file
 * measures, and the diff engine says whether a measurement is news. What is
 * here is the state the diff engine deliberately does not keep — which
 * providers have already been told about, for which month.
 */

const MINUTE_MS = 60_000;

export interface SlaBudget {
  providerId: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  /** The configured target, as a percentage. */
  target: number;
  /** Measured uptime so far this month, as a percentage; `null` when nothing was measured. */
  uptime: number | null;
  /** Minutes of downtime the target allows over the whole month. */
  budgetMinutes: number;
  /** Minutes of it spent so far. May exceed the budget. */
  spentMinutes: number;
  /** What is left, floored at zero — a budget cannot be less than spent. */
  remainingMinutes: number;
  /**
   * Spend against elapsed time: 1 is exactly on budget, 2 is spending it twice
   * as fast as the month can afford. `null` when nothing has been measured.
   *
   * The number the row asked for, and the one worth putting on a dashboard:
   * "13 of 43 minutes" needs the reader to know what day it is, and this does
   * not.
   */
  burnRate: number | null;
  /** Where the month lands at this rate, as a percentage; `null` when unmeasured. */
  projectedUptime: number | null;
  /** Whether that projection is under the target. */
  willMiss: boolean;
  /** How much of the month has gone, and how much of it was actually sampled. */
  elapsedMinutes: number;
  monthMinutes: number;
  measuredMinutes: number;
}

/** `2026-09-16T…` → `2026-09`. */
export const monthKey = (at: Date): string => at.toISOString().slice(0, 7);

/** How many minutes the calendar month holding `at` has in it. */
export function monthMinutes(at: Date): number {
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
  return (next - start) / MINUTE_MS;
}

/** How many minutes of it have already gone at `at`. */
export function elapsedMinutes(at: Date): number {
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  return Math.max(0, (at.getTime() - start) / MINUTE_MS);
}

export interface SlaDeps {
  history: ReturnType<typeof createHistoryService>;
  /** Injected so a test does not depend on which day of the month it runs on. */
  now?: (() => Date) | undefined;
}

export function createSlaService(deps: SlaDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Every provider that has a target, measured against it for the month `at`
   * falls in. Providers without one are absent rather than reported at 100%:
   * nobody promised anything about them, and a table of mostly-imaginary
   * targets is worse than a short one.
   */
  async function budgets(
    services: ServiceDefinition[],
    intervalMinutes: number,
  ): Promise<SlaBudget[]> {
    const withTarget = services.filter(
      (service): service is ServiceDefinition & { slaTarget: number } => service.slaTarget !== undefined,
    );
    if (withTarget.length === 0) return [];

    const at = now();
    const month = monthKey(at);
    const report = await deps.history.getMonthlyReport(
      month,
      intervalMinutes,
      withTarget.map((service) => service.id),
    );
    const byProvider = new Map(report.providers.map((provider) => [provider.providerId, provider]));

    const wholeMonth = monthMinutes(at);
    const elapsed = elapsedMinutes(at);

    return withTarget.map((service) => {
      const measured = byProvider.get(service.id);
      const target = service.slaTarget;
      const budgetMinutes = round1((wholeMonth * (100 - target)) / 100);
      const uptime = measured?.uptime ?? null;
      // How long we actually watched, in minutes: sample count times cadence,
      // which is the same arithmetic `downtimeMinutes` is already reported
      // from. A month nobody polled is measured for zero minutes, and every
      // figure below has to be null rather than flattering.
      const measuredMinutes = (measured?.sampleCount ?? 0) * intervalMinutes;
      if (uptime === null || measuredMinutes === 0) {
        return {
          providerId: service.id,
          month,
          target,
          uptime: null,
          budgetMinutes,
          spentMinutes: 0,
          remainingMinutes: budgetMinutes,
          burnRate: null,
          projectedUptime: null,
          willMiss: false,
          elapsedMinutes: Math.round(elapsed),
          monthMinutes: wholeMonth,
          measuredMinutes: 0,
        };
      }

      const spentMinutes = round1((measuredMinutes * (100 - uptime)) / 100);
      // Against elapsed time rather than against measured time: an instance
      // that was off for a week has not thereby earned a better burn rate, and
      // the operator can see `measuredMinutes` beside it to judge the reading.
      const affordable = (elapsed * (100 - target)) / 100;
      return {
        providerId: service.id,
        month,
        target,
        uptime,
        budgetMinutes,
        spentMinutes,
        remainingMinutes: round1(Math.max(0, budgetMinutes - spentMinutes)),
        burnRate: affordable <= 0 ? null : round2(spentMinutes / affordable),
        projectedUptime: uptime,
        willMiss: uptime < target,
        elapsedMinutes: Math.round(elapsed),
        monthMinutes: wholeMonth,
        measuredMinutes: Math.round(measuredMinutes),
      };
    });
  }

  /**
   * The changes this cycle should carry, which is at most one per provider and
   * at most one per provider per month.
   *
   * `alreadyTold` and `remember` are handed in rather than read here so that
   * the arithmetic stays testable without a database, and so the one place that
   * writes the marker is the caller that also dispatched the message — a marker
   * written by a cycle whose dispatch then failed is a month of silence.
   */
  async function burnChanges(
    services: ServiceDefinition[],
    intervalMinutes: number,
    alreadyTold: (providerId: string, month: string) => boolean,
  ): Promise<StatusChange[]> {
    const at = now();
    const changes: StatusChange[] = [];
    for (const budget of await budgets(services, intervalMinutes)) {
      if (budget.uptime === null) continue;
      if (alreadyTold(budget.providerId, budget.month)) continue;
      const change = slaBurn({
        providerId: budget.providerId,
        month: budget.month,
        target: budget.target,
        uptime: budget.uptime,
        monthMinutes: budget.monthMinutes,
        measuredMinutes: budget.measuredMinutes,
        at: at.toISOString(),
      });
      if (change !== null) changes.push(change);
    }
    return changes;
  }

  return { budgets, burnChanges };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Which providers have already been told about, and for which month.
 *
 * In SQLite rather than in memory, unlike the dispatcher's hourly cap: that cap
 * covers an hour and a restart is the one moment an operator is watching, while
 * this covers a month and a restart on the 12th would repeat a sentence nobody
 * needs twice. An operator who reads the same alert every deploy stops reading
 * the alerts.
 */
export function slaAlreadyTold(db: DatabaseSync, providerId: string, month: string): boolean {
  const rows = db
    .prepare("SELECT 1 FROM sla_notices WHERE provider_id = ? AND month = ?")
    .all(providerId, month);
  return rows.length > 0;
}

/**
 * Written only after the message has actually been handed to the dispatcher: a
 * marker written first, by a cycle whose dispatch then threw, is a month of
 * silence about a budget that is already gone.
 */
export function rememberSlaNotice(db: DatabaseSync, providerId: string, month: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO sla_notices (provider_id, month, notified_at) VALUES (?, ?, ?)",
  ).run(providerId, month, new Date().toISOString());
}
