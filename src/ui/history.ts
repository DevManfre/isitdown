import type { DailyBucket, HistoryStore } from "./historyStore.interface.ts";
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

  async function getSummary(days: number, intervalMinutes: number): Promise<HistorySummary> {
    const today = now();
    const providerIds = await store.listProviderIds();
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

  return { getProviderHistory, getComponentHistories, getSummary };
}

const uptimeKey = (provider: ProviderHistory, days: number): number =>
  days <= 7 ? provider.uptime7 : days <= 30 ? provider.uptime30 : provider.uptime90;

const round2 = (value: number): number => Math.round(value * 100) / 100;
