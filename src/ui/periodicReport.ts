import type { ServiceDefinition } from "../core/configSource.interface.ts";
import type { ReportConfig } from "../core/delivery.ts";
import type { StatusChange } from "../core/types.ts";
import type { createHistoryService } from "./history.ts";
import { monthMinutes, type createSlaService } from "./sla.ts";

/**
 * The periodic report (roadmap 3.13): the figures of the monthly Markdown
 * report, delivered on a schedule instead of waiting for somebody to download
 * them.
 *
 * It reads the same daily buckets the History view and the monthly report read
 * (`getRangeReport`), so a number here cannot disagree with the screen it was
 * taken beside. What it adds is the question the other two never ask: *is it
 * due* — answered from the calendar and from one stored marker.
 *
 * Periods are UTC calendar periods, like every other day key in the history
 * code: a week is Monday to Sunday, a month is the calendar month. The report
 * for a period goes out on the first poll after it closes.
 */

const DAY_MS = 86_400_000;

export interface ReportPeriod {
  /** Prefixed with the frequency, so switching one for the other never matches a stale marker. */
  key: string;
  /** First and last day covered, inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The most recent period that has fully closed at `at`: last week for a weekly
 * report, last month for a monthly one. Never the one in progress — a report on
 * a week that is still running would be sent short and then never again.
 */
export function reportPeriod(frequency: ReportConfig["frequency"], at: Date): ReportPeriod {
  if (frequency === "monthly") {
    const first = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 1);
    const last = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 0);
    return { key: `monthly:${dayKey(first).slice(0, 7)}`, from: dayKey(first), to: dayKey(last) };
  }
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const thisMonday = today - sinceMonday * DAY_MS;
  const from = dayKey(thisMonday - 7 * DAY_MS);
  return { key: `weekly:${from}`, from, to: dayKey(thisMonday - DAY_MS) };
}

export interface ReportDeps {
  history: ReturnType<typeof createHistoryService>;
  sla: ReturnType<typeof createSlaService>;
}

/** How many providers the "weakest" list names. */
const WORST_SHOWN = 3;

export function createReportService(deps: ReportDeps) {
  /**
   * The report as a change the dispatcher can send, or null when there are no
   * providers to report on. `subject` stands in as the change's provider, for
   * the same reason `channel_failing` names one: routing and the delivery log
   * need a real subject to hang a message on, even though this one is about all
   * of them.
   */
  async function build(
    services: ServiceDefinition[],
    frequency: ReportConfig["frequency"],
    intervalMinutes: number,
    at: Date,
  ): Promise<StatusChange | null> {
    const enabled = services.filter((service) => service.enabled);
    const [subject] = enabled;
    if (subject === undefined) return null;

    const period = reportPeriod(frequency, at);
    const range = await deps.history.getRangeReport(
      period.from,
      period.to,
      intervalMinutes,
      enabled.map((service) => service.id),
    );

    const worst = range.providers
      .filter((provider): provider is typeof provider & { uptime: number } => provider.uptime !== null && provider.uptime < 100)
      .sort((a, b) => a.uptime - b.uptime || a.providerId.localeCompare(b.providerId))
      .slice(0, WORST_SHOWN)
      .map((provider) => ({ providerId: provider.providerId, uptime: provider.uptime }));

    const targets = enabled.filter(
      (service): service is ServiceDefinition & { slaTarget: number } => service.slaTarget !== undefined,
    );
    // A monthly report is about a month that has ended, so its budget is that
    // month's, spent as the range measured it. A weekly one is about a week of a
    // month that is still running, and the budget that matters is the month's so
    // far — the figure `sla_burn` already warns about.
    const sla =
      frequency === "monthly"
        ? targets.map((service) => {
            const spent = range.providers.find((provider) => provider.providerId === service.id)?.downtimeMinutes ?? 0;
            return {
              providerId: service.id,
              target: service.slaTarget,
              spentMinutes: spent,
              budgetMinutes: (monthMinutes(new Date(`${period.from}T00:00:00Z`)) * (100 - service.slaTarget)) / 100,
            };
          })
        : (await deps.sla.budgets(targets, intervalMinutes)).map((budget) => ({
            providerId: budget.providerId,
            target: budget.target,
            spentMinutes: budget.spentMinutes,
            budgetMinutes: budget.budgetMinutes,
          }));

    return {
      kind: "periodic_report",
      providerId: subject.id,
      currentStatus: "unknown",
      report: {
        frequency,
        from: period.from,
        to: period.to,
        fleetUptime: range.fleetUptime,
        incidentCount: range.incidents.length,
        worst,
        sla,
      },
      at: at.toISOString(),
    };
  }

  return { build };
}
