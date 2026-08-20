import type { DailyBucket, HistoryStore } from "./historyStore.interface.ts";
import type { OverallStatus } from "../core/types.ts";

const DAY_MS = 24 * 3600 * 1000;
/** Enough days to cover both a 90-day view and four calendar months. */
const WINDOW_DAYS = 120;
const MONTHS_SHOWN = 4;

export interface HistoryBucket {
  day: string;
  status: OverallStatus;
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
    return {
      aggregateUptime:
        measured.length === 0
          ? 0
          : round2(
              measured.reduce((sum, provider) => sum + uptimeKey(provider, days), 0) / measured.length,
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
