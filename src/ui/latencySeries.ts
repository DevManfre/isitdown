/**
 * Percentiles of the page's response time over a window — roadmap 4.14.
 *
 * Computed here rather than in SQL because SQLite has no percentile, and from
 * the raw readings rather than from averages of averages: a p95 of hourly p95s
 * is not the p95 of the day.
 */
export interface LatencySample {
  observedAt: string;
  latencyMs: number;
}

export interface LatencyPoint {
  /** Start of the bucket, ISO. */
  at: string;
  p50: number;
  p95: number;
  samples: number;
}

export interface LatencySummary {
  p50: number;
  p95: number;
  samples: number;
  /** Readings at or over `slowMs`; null when the provider declares no threshold. */
  overSlow: number | null;
}

/**
 * Nearest rank: always one of the readings that happened, never an
 * interpolation between two, so the number on screen is a latency somebody saw.
 */
export function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

const sortedLatencies = (samples: readonly LatencySample[]): number[] =>
  samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);

/** One point per bucket that has a reading, oldest first. An empty bucket is absent, not zero. */
export function latencySeries(samples: readonly LatencySample[], bucketMs: number): LatencyPoint[] {
  const buckets = new Map<number, LatencySample[]>();
  for (const sample of samples) {
    const start = Math.floor(Date.parse(sample.observedAt) / bucketMs) * bucketMs;
    buckets.set(start, [...(buckets.get(start) ?? []), sample]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([start, inBucket]) => {
      const sorted = sortedLatencies(inBucket);
      return {
        at: new Date(start).toISOString(),
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        samples: sorted.length,
      };
    });
}

export function latencySummary(samples: readonly LatencySample[], slowMs: number | null): LatencySummary | null {
  if (samples.length === 0) return null;
  const sorted = sortedLatencies(samples);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    samples: sorted.length,
    overSlow: slowMs === null ? null : sorted.filter((value) => value >= slowMs).length,
  };
}
