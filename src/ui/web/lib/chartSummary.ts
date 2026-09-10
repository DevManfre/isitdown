/**
 * What a run of status bars says out loud (roadmap 5.13).
 *
 * The uptime bars, the strip under a table row and the poll strip are all the
 * same statement — "this many days/polls, and this is how they went" — drawn
 * three ways. A screen reader gets that sentence rather than a run of unlabelled
 * rects, and it is counted here so the three components cannot disagree about
 * what "with issues" means.
 */
export interface StatusTally {
  count: number;
  ok: number;
  issues: number;
  unmeasured: number;
  /** Passed straight to `t()` as interpolation values, which wants an index signature. */
  [key: string]: number;
}

export function tallyStatuses(statuses: readonly string[]): StatusTally {
  let ok = 0;
  let unmeasured = 0;
  for (const status of statuses) {
    if (status === "operational") ok += 1;
    else if (status === "unknown") unmeasured += 1;
  }
  return { count: statuses.length, ok, issues: statuses.length - ok - unmeasured, unmeasured };
}

/** Lowest and highest measured uptime in a series, or null when nothing was measured. */
export function uptimeRange(series: readonly { uptime: number | null }[]): { min: number; max: number } | null {
  const measured = series.map((entry) => entry.uptime).filter((value): value is number => value !== null);
  if (measured.length === 0) return null;
  return { min: Math.min(...measured), max: Math.max(...measured) };
}
