import type { DailyBucket, HistoryStore, IncidentRow } from "./historyStore.interface.ts";
import type { OverallStatus } from "../core/types.ts";

const DAY_MS = 24 * 3600 * 1000;
/**
 * Enough days to cover a 90-day view, the 90-day window it is compared
 * against, and four calendar months.
 */
const WINDOW_DAYS = 180;
const MONTHS_SHOWN = 4;

export interface HistoryBucket {
  day: string;
  status: OverallStatus;
}

/**
 * One day's uptime as a percentage, or `null` when nothing was sampled that
 * day. `null` rather than 0 because the trend chart has to break its line at
 * an unmeasured day: a 0 would draw a full-day outage that never happened.
 */
export interface DayUptime {
  day: string;
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
   * Samples backing the percentages in this window. Zero means never measured,
   * which is a different statement from 0% uptime and must not be averaged in.
   */
  sampleCount: number;
  incidentCount: number;
  downtimeMinutes: number;
  /**
   * Exactly `days` entries, oldest first, gap-filled with `uptime: null`.
   * `buckets` answers "what status was that day"; this answers "how much of
   * it was up", which a worst-status cannot: one bad sample out of ninety
   * colours the bar exactly like ninety bad ones.
   */
  dailySeries: DayUptime[];
  /**
   * The same-length window immediately before this one, for the delta the
   * dashboard prints beside its headline. `null` when that window holds no
   * samples.
   */
  previousUptime: number | null;
}

/**
 * One day in the year calendar — roadmap 5.20.
 *
 * `status` is the day's worst reading, which is what colours the cell, and
 * `uptime` is how much of it was up, which is what the cell says on hover. The
 * two are separate for the same reason `buckets` and `dailySeries` are: one bad
 * sample out of a day's worth colours the cell exactly like a day that was down
 * throughout, and only the percentage tells the two apart.
 */
export interface CalendarDay {
  day: string;
  status: OverallStatus;
  uptime: number | null;
}

export interface ProviderCalendar {
  providerId: string;
  days: number;
  /** Exactly `days` entries, oldest first, gap-filled with `unknown` / `null`. */
  cells: CalendarDay[];
  /** Uptime across the whole window, on the same rule as every other figure here. */
  uptime: number;
  /** Days with at least one sample — how much of the year is real rather than gap-filled. */
  measuredDays: number;
}

export interface ComponentHistory {
  componentId: string;
  name: string;
  /** Exactly `days` entries, oldest first, gap-filled `unknown`. */
  buckets: HistoryBucket[];
  uptime7: number;
  uptime30: number;
  uptime90: number;
  sampleCount: number;
}

export interface HistorySummary {
  aggregateUptime: number;
  /**
   * Fleet uptime per day: the unweighted mean across the providers measured
   * that day, `null` on a day none were.
   *
   * Unweighted on purpose — the same one-provider-one-vote rule
   * `aggregateUptime` already uses. A sample-weighted mean would let the line
   * and the figure printed beside it disagree, and the operator would have no
   * way to tell which of the two to trust.
   */
  dailyUptime: DayUptime[];
  /**
   * The fleet's change against the previous window of equal length, in
   * percentage points. `null` when nothing exists to compare.
   *
   * Computed here, over the providers with samples in BOTH windows — never
   * by having the client subtract `aggregateUptime` from a published
   * "previous aggregate". `aggregateUptime` averages every provider with
   * samples now; a previous-window aggregate published alongside it would
   * only ever average the providers that already existed that far back —
   * usually a smaller set. A mean over seven providers minus a mean over
   * four is not a change in anything, it is an artifact of which providers
   * happen to be new. This file's own rule is that the dashboard never
   * re-derives a figure from other figures it was sent (see the module
   * doc comment); the aggregate delta is exactly that kind of figure, so it
   * is computed once, here, and shipped as a single number the client only
   * paints.
   */
  aggregateDelta: number | null;
  /** `uptime` is null for a month with no samples: 0% would read as an outage. */
  months: { month: string; uptime: number | null }[];
  providers: ProviderHistory[];
}

/**
 * One provider's month, in the report of roadmap 4.7.
 *
 * `uptime` is `null` rather than 0 when the month holds no samples at all: a
 * provider added halfway through, or one that was disabled, did not have a bad
 * month — it had no month, and averaging a 0 into the fleet figure would say
 * something untrue about everything else.
 */
export interface MonthlyProviderReport {
  providerId: string;
  uptime: number | null;
  /** Days of the month with at least one sample — how much of it is real. */
  measuredDays: number;
  sampleCount: number;
  downtimeMinutes: number;
  /** Incidents open at any point in the month, not only those that started in it. */
  incidentCount: number;
  /**
   * The measured day with the least uptime, which is the day worth looking up.
   * `null` when nothing was measured. A month with no trouble still names one,
   * at 100% — "which day was worst" and "was any day bad" are different
   * questions, and the second is answered by the number rather than by absence.
   */
  worstDay: { day: string; uptime: number; status: OverallStatus } | null;
}

export interface MonthlyReport {
  /** `YYYY-MM`, UTC, like every other day key here. */
  month: string;
  /** First and last day covered, inclusive. */
  from: string;
  to: string;
  /**
   * The month is not over, so the figures below cover part of it. Reported
   * rather than refused: the useful time to read this month's report is during
   * this month, and a report that hides that it is partial is the dangerous
   * one.
   */
  partial: boolean;
  /** Mean of the measured providers' uptime, on the same rule as the summary's. */
  fleetUptime: number | null;
  providers: MonthlyProviderReport[];
  /** Every incident open at any point in the month, newest first. */
  incidents: IncidentRow[];
}

export interface HistoryServiceDeps {
  /** Injected so day bucketing does not depend on when a test runs. */
  now?: (() => Date) | undefined;
}

/**
 * Uptime and incident aggregation, server-side and in one place.
 *
 * The dashboard never re-derives any of this: the uptime bars, the percentages
 * and the incident timeline all come from the same samples and the same incident
 * rows, so no two views of the same window can disagree.
 *
 * Percentages are returned as numbers, never as formatted strings — the client
 * formats them with `Intl` in the active locale.
 */
export function createHistoryService(store: HistoryStore, deps: HistoryServiceDeps = {}) {
  const now = deps.now ?? (() => new Date());

  const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

  function uptimeOver(buckets: DailyBucket[], days: number, today: Date): number {
    const from = dayKey(new Date(today.getTime() - (days - 1) * DAY_MS));
    let ok = 0;
    let total = 0;
    for (const bucket of buckets) {
      if (bucket.day < from) continue;
      ok += bucket.okSamples;
      total += bucket.totalSamples;
    }
    // No samples in the window is not 100%: it is nothing observed.
    return total === 0 ? 0 : round2((ok / total) * 100);
  }

  function fill(buckets: DailyBucket[], days: number, today: Date): HistoryBucket[] {
    const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]));
    const filled: HistoryBucket[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = dayKey(new Date(today.getTime() - offset * DAY_MS));
      // A day with no samples is rendered, not skipped: dropping it would shift
      // every later bar and quietly misdate the whole row.
      filled.push({ day, status: byDay.get(day)?.worstStatus ?? "unknown" });
    }
    return filled;
  }

  /**
   * Per-day uptime over the same gap-filled window `fill` walks. Deliberately
   * not folded into `fill`: a bucket's `worstStatus` and its ok/total ratio
   * answer different questions, and on an unmeasured day one is `"unknown"`
   * while the other is `null`.
   */
  function dailySeriesOf(buckets: DailyBucket[], days: number, today: Date): DayUptime[] {
    const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket]));
    const series: DayUptime[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = dayKey(new Date(today.getTime() - offset * DAY_MS));
      const bucket = byDay.get(day);
      series.push({
        day,
        uptime:
          bucket === undefined || bucket.totalSamples === 0
            ? null
            : round2((bucket.okSamples / bucket.totalSamples) * 100),
      });
    }
    return series;
  }

  /**
   * Uptime over an explicit day range, `null` when the range holds no samples.
   *
   * `uptimeOver` answers 0 for an unmeasured window, which is right for the
   * headline figures it feeds — they sit beside a `sampleCount` that says as
   * much. A delta cannot use that answer: it would print a 92-point fall on a
   * dashboard that has simply not been running long enough.
   */
  function uptimeBetween(buckets: DailyBucket[], fromDay: string, toDay: string): number | null {
    let ok = 0;
    let total = 0;
    for (const bucket of buckets) {
      if (bucket.day < fromDay || bucket.day > toDay) continue;
      ok += bucket.okSamples;
      total += bucket.totalSamples;
    }
    return total === 0 ? null : round2((ok / total) * 100);
  }

  /**
   * The fleet's own daily series, keyed by day rather than by array index:
   * every `getProviderHistory` call reads `now()` for itself, so positional
   * alignment between two providers' series is an assumption, not a
   * guarantee. A day is `null` when no provider measured it.
   */
  function aggregateDaily(providers: ProviderHistory[], days: number, today: Date): DayUptime[] {
    const byProvider = providers.map(
      (provider) => new Map(provider.dailySeries.map((entry) => [entry.day, entry.uptime])),
    );
    const series: DayUptime[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = dayKey(new Date(today.getTime() - offset * DAY_MS));
      const measured: number[] = [];
      for (const provider of byProvider) {
        const uptime = provider.get(day);
        if (uptime !== undefined && uptime !== null) measured.push(uptime);
      }
      series.push({
        day,
        uptime:
          measured.length === 0
            ? null
            : round2(measured.reduce((sum, value) => sum + value, 0) / measured.length),
      });
    }
    return series;
  }

  async function getProviderHistory(
    providerId: string,
    days: number,
    intervalMinutes: number,
  ): Promise<ProviderHistory> {
    const today = now();
    const buckets = await store.getDailyBuckets(providerId, WINDOW_DAYS);
    const incidents = await store.listIncidents({ providerId, days });

    let notOk = 0;
    let sampleCount = 0;
    const from = dayKey(new Date(today.getTime() - (days - 1) * DAY_MS));
    for (const bucket of buckets) {
      if (bucket.day < from) continue;
      notOk += bucket.totalSamples - bucket.okSamples;
      sampleCount += bucket.totalSamples;
    }

    return {
      providerId,
      buckets: fill(buckets, days, today),
      uptime7: uptimeOver(buckets, 7, today),
      uptime30: uptimeOver(buckets, 30, today),
      uptime90: uptimeOver(buckets, 90, today),
      sampleCount,
      incidentCount: incidents.length,
      downtimeMinutes: notOk * intervalMinutes,
      dailySeries: dailySeriesOf(buckets, days, today),
      previousUptime: uptimeBetween(
        buckets,
        dayKey(new Date(today.getTime() - (2 * days - 1) * DAY_MS)),
        dayKey(new Date(today.getTime() - days * DAY_MS)),
      ),
    };
  }

  async function getComponentHistories(
    providerId: string,
    selection: { id: string; name: string }[],
    days: number,
  ): Promise<ComponentHistory[]> {
    const today = now();
    const from = dayKey(new Date(today.getTime() - (days - 1) * DAY_MS));
    return Promise.all(
      selection.map(async ({ id, name }) => {
        const buckets = await store.getComponentDailyBuckets(providerId, id, WINDOW_DAYS);
        let sampleCount = 0;
        for (const bucket of buckets) {
          if (bucket.day < from) continue;
          sampleCount += bucket.totalSamples;
        }
        return {
          componentId: id,
          name,
          buckets: fill(buckets, days, today),
          uptime7: uptimeOver(buckets, 7, today),
          uptime30: uptimeOver(buckets, 30, today),
          uptime90: uptimeOver(buckets, 90, today),
          sampleCount,
        };
      }),
    );
  }

  /**
   * A year of day cells for one provider — roadmap 5.20.
   *
   * Reads `days` of buckets rather than the shared `WINDOW_DAYS`: that constant
   * exists to cover a 90-day view and the window it is compared against, and a
   * year is neither. Retention has been allowed to run to 3650 days since 4.5,
   * so the samples are there; this is the view that shows them.
   */
  async function getProviderCalendar(providerId: string, days: number): Promise<ProviderCalendar> {
    const today = now();
    const buckets = await store.getDailyBuckets(providerId, days);
    const uptimeByDay = new Map(dailySeriesOf(buckets, days, today).map((entry) => [entry.day, entry.uptime]));

    return {
      providerId,
      days,
      cells: fill(buckets, days, today).map((bucket) => ({
        day: bucket.day,
        status: bucket.status,
        uptime: uptimeByDay.get(bucket.day) ?? null,
      })),
      uptime: uptimeOver(buckets, days, today),
      measuredDays: [...uptimeByDay.values()].filter((uptime) => uptime !== null).length,
    };
  }

  /**
   * One calendar month, per provider and for the fleet — roadmap 4.7.
   *
   * It reads the same daily buckets and the same incident rows every other
   * figure here comes from, so a month's report can never disagree with the
   * History view it was taken beside. What it adds is the shape of a month
   * rather than of a rolling window: the 30-day view answers "how have we been
   * doing lately", and this answers "how was August", which is the one somebody
   * asks for in writing.
   *
   * `month` is `YYYY-MM`, UTC. A month still running is reported as far as
   * today and flagged `partial`, rather than refused — the useful time to read
   * this month's report is during this month.
   */
  async function getMonthlyReport(
    month: string,
    intervalMinutes: number,
    only?: string[] | undefined,
  ): Promise<MonthlyReport> {
    const today = now();
    const todayKey = dayKey(today);
    const start = new Date(`${month}-01T00:00:00.000Z`);
    // The last day of the month is the day before the first of the next one.
    const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const lastDay = dayKey(new Date(nextMonth.getTime() - DAY_MS));
    const to = lastDay > todayKey ? todayKey : lastDay;
    const from = `${month}-01`;

    // How far back the store has to reach for the month to be inside the
    // window. `getDailyBuckets` counts days back from today, which is the one
    // thing it knows how to do, so the month is selected from what comes back.
    const daysBack = Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY_MS) + 1);

    const providerIds = only ?? (await store.listProviderIds());
    const providers: MonthlyProviderReport[] = [];
    const incidents: IncidentRow[] = [];

    for (const providerId of providerIds) {
      const buckets = (await store.getDailyBuckets(providerId, daysBack)).filter(
        (bucket) => bucket.day >= from && bucket.day <= to,
      );

      let ok = 0;
      let total = 0;
      let measuredDays = 0;
      let worstDay: MonthlyProviderReport["worstDay"] = null;
      for (const bucket of buckets) {
        ok += bucket.okSamples;
        total += bucket.totalSamples;
        if (bucket.totalSamples === 0) continue;
        measuredDays += 1;
        const uptime = round2((bucket.okSamples / bucket.totalSamples) * 100);
        // Strictly less, so a tie keeps the earlier day: "the worst day" should
        // be stable between two runs of the same report.
        if (worstDay === null || uptime < worstDay.uptime) {
          worstDay = { day: bucket.day, uptime, status: bucket.worstStatus };
        }
      }

      // Open at any point in the month, not merely started in it: an outage
      // that began in July and ran into August is part of August's story, and
      // a report that dropped it would show downtime with nothing causing it.
      const open = await store.listIncidents({ providerId, openFrom: from, openTo: to });
      incidents.push(...open);

      providers.push({
        providerId,
        uptime: total === 0 ? null : round2((ok / total) * 100),
        measuredDays,
        sampleCount: total,
        downtimeMinutes: (total - ok) * intervalMinutes,
        incidentCount: open.length,
        worstDay,
      });
    }

    // Measured means "has samples". Same rule as the summary's headline, and
    // for the same reason: a provider nobody polled must not drag the fleet
    // figure down as though it had been down.
    const measured = providers.filter(
      (provider): provider is MonthlyProviderReport & { uptime: number } => provider.uptime !== null,
    );

    return {
      month,
      from,
      to,
      partial: lastDay > todayKey,
      fleetUptime:
        measured.length === 0
          ? null
          : round2(measured.reduce((sum, provider) => sum + provider.uptime, 0) / measured.length),
      providers,
      incidents: incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    };
  }

  /**
   * `only` narrows the summary to a caller-supplied set of providers — how the
   * history page drops a disabled one. The store still keeps every provider's
   * samples, so an omitted provider is hidden rather than forgotten, and it
   * comes back with its whole history when it is re-enabled. Omitting `only`
   * summarises everything the store knows.
   */
  async function getSummary(
    days: number,
    intervalMinutes: number,
    only?: string[] | undefined,
  ): Promise<HistorySummary> {
    const today = now();
    const stored = await store.listProviderIds();
    const providerIds = only === undefined ? stored : stored.filter((id) => only.includes(id));
    const providers = await Promise.all(
      providerIds.map((providerId) => getProviderHistory(providerId, days, intervalMinutes)),
    );

    const monthTotals = new Map<string, { ok: number; total: number }>();
    for (let back = MONTHS_SHOWN - 1; back >= 0; back -= 1) {
      const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
      monthTotals.set(month.toISOString().slice(0, 7), { ok: 0, total: 0 });
    }
    for (const providerId of providerIds) {
      for (const bucket of await store.getDailyBuckets(providerId, WINDOW_DAYS)) {
        const totals = monthTotals.get(bucket.day.slice(0, 7));
        if (totals === undefined) continue;
        totals.ok += bucket.okSamples;
        totals.total += bucket.totalSamples;
      }
    }

    // Measured means "has samples", not "has uptime above zero". A provider that
    // was fully down was measured, and averaging it out would let the headline
    // claim 100% while a month below it reports real downtime.
    const measured = providers.filter((provider) => provider.sampleCount > 0);
    // The delta's own set: providers measured in *both* windows. Deliberately
    // not `measured` (current window only) and not "has previousUptime" alone
    // (previous window only) — either one lets a provider that is missing from
    // the other window distort the comparison. See the `aggregateDelta` doc
    // comment on `HistorySummary` for why this can't instead be `aggregateUptime`
    // minus a published previous-window mean.
    const comparable = measured.filter(
      (provider): provider is typeof provider & { previousUptime: number } =>
        provider.previousUptime !== null,
    );
    return {
      aggregateUptime:
        measured.length === 0
          ? 0
          : round2(
              measured.reduce((sum, provider) => sum + uptimeKey(provider, days), 0) / measured.length,
            ),
      dailyUptime: aggregateDaily(providers, days, today),
      aggregateDelta:
        comparable.length === 0
          ? null
          : round2(
              comparable.reduce((sum, provider) => sum + uptimeKey(provider, days), 0) / comparable.length -
                comparable.reduce((sum, provider) => sum + provider.previousUptime, 0) / comparable.length,
            ),
      months: [...monthTotals.entries()].map(([month, totals]) => ({
        month,
        uptime: totals.total === 0 ? null : round2((totals.ok / totals.total) * 100),
      })),
      providers,
    };
  }

  return { getProviderHistory, getProviderCalendar, getComponentHistories, getSummary, getMonthlyReport };
}

const uptimeKey = (provider: ProviderHistory, days: number): number =>
  days <= 7 ? provider.uptime7 : days <= 30 ? provider.uptime30 : provider.uptime90;

const round2 = (value: number): number => Math.round(value * 100) / 100;
