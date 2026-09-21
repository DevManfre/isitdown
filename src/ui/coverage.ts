import type { DaySegment } from "./calendarDays.ts";

/**
 * How much of each day the poller was actually running — roadmap 10.1.
 *
 * The founding bug of the whole history subsystem. If the container is down for
 * six hours those hours are not in `status_samples`, and nothing distinguishes
 * them from six hours in which the provider was fine: a bar draws them as a day
 * with fewer samples, a percentage quietly leaves them out of both sides of its
 * fraction, and an operator reading 100% has no way to learn that nobody was
 * looking. Every figure on the History view inherits the ambiguity.
 *
 * The fix is a second trace. One row per finished cycle says the poller was
 * alive then; a silence longer than the cadence it was running at says it was
 * not. That turns "no samples" into two different statements — *nothing was
 * wrong* and *nobody was watching* — which is the distinction the view was
 * missing.
 *
 * Coverage is a property of the poller, not of a provider: one loop reads the
 * whole fleet, so a gap is a gap for everybody. It is reported once and drawn
 * beside every provider.
 */

/** One finished cycle, as the store holds it. */
export interface PollCycle {
  startedAt: string;
  finishedAt: string;
  /** The cadence the fleet was on when this cycle ran. */
  intervalMinutes: number;
}

export interface DayCoverage {
  day: string;
  /**
   * Fraction of the day the poller was running, 0 to 1.
   *
   * `null` means *we cannot say*, which is not the same as zero. Before the
   * first cycle this database ever recorded — an install that predates this
   * trace, or one that simply did not exist yet — there is no evidence either
   * way, and drawing that as an outage of ours would be a claim made out of
   * missing data. A chart renders `null` as an ordinary gap and 0 as the
   * hatching that says nobody was looking.
   */
  observed: number | null;
}

/**
 * How long a silence has to be before it counts as one, as a multiple of the
 * cadence the last cycle ran at.
 *
 * Two, not one: a cycle that takes longer than usual, a manual poll that shifts
 * the timer, and the jitter the scheduler deliberately adds (a tenth of the
 * interval, either way) all stretch the gap between two cycles without anything
 * having stopped. One would flag a healthy poller; two flags a missed beat.
 */
const GRACE_MULTIPLE = 2;

/** An interval nobody was watching, as UTC milliseconds. */
interface Gap {
  from: number;
  to: number;
}

/**
 * The stretches between cycles long enough to be an absence, plus the one
 * running from the last cycle to `now` if the poller has gone quiet since.
 *
 * Cycles are expected oldest first.
 */
export function gapsBetween(cycles: readonly PollCycle[], now: Date): Gap[] {
  const gaps: Gap[] = [];
  for (const [index, cycle] of cycles.entries()) {
    const ended = Date.parse(cycle.finishedAt);
    const nextStart = index + 1 < cycles.length ? Date.parse(cycles[index + 1]!.startedAt) : now.getTime();
    // Measured from the end of one cycle to the start of the next, because the
    // time a cycle spends running is time the poller was demonstrably alive.
    const allowed = cycle.intervalMinutes * GRACE_MULTIPLE * 60_000;
    if (nextStart - ended > allowed) gaps.push({ from: ended, to: nextStart });
  }
  return gaps;
}

/**
 * Per-day coverage over the window the segments describe, oldest first, one
 * entry per calendar day with no days skipped.
 *
 * Days before the first recorded cycle come back `null` — see `DayCoverage`.
 */
export function coverageByDay(
  cycles: readonly PollCycle[],
  segments: readonly DaySegment[],
  days: readonly string[],
  now: Date,
): DayCoverage[] {
  const first = cycles[0] === undefined ? null : Date.parse(cycles[0].startedAt);
  const gaps = gapsBetween(cycles, now);

  // Day boundaries, in the operator's zone: the same seams the samples are
  // bucketed on, so a day's coverage and a day's uptime are measured over
  // exactly the same hours.
  const bounds = new Map<string, { from: number; to: number }>();
  for (const segment of segments) {
    const from = Date.parse(segment.fromIso);
    const to = Date.parse(segment.toIso);
    const shift = segment.offsetMinutes * 60_000;
    for (let at = from; at < to; ) {
      const day = new Date(at + shift).toISOString().slice(0, 10);
      // The end of this local day, brought back to UTC, clipped to the segment:
      // the day a transition falls on is reached twice, once from each side.
      const dayEnd = Math.min(
        to,
        Date.parse(`${day}T00:00:00.000Z`) + 24 * 3600 * 1000 - shift,
      );
      const existing = bounds.get(day);
      if (existing === undefined) bounds.set(day, { from: at, to: dayEnd });
      else existing.to = Math.max(existing.to, dayEnd);
      at = dayEnd;
    }
  }

  return days.map((day) => {
    const bound = bounds.get(day);
    if (bound === undefined) return { day, observed: null };
    const span = bound.to - bound.from;
    if (span <= 0) return { day, observed: null };
    // A day that ends before the first cycle we ever saw is unjudged; one that
    // straddles it is judged on the part we have evidence for, which is why the
    // start is clamped rather than the whole day discarded.
    if (first === null || bound.to <= first) return { day, observed: null };
    const from = Math.max(bound.from, first);
    const to = Math.min(bound.to, now.getTime());
    if (to <= from) return { day, observed: null };

    let missing = 0;
    for (const gap of gaps) {
      const overlap = Math.min(to, gap.to) - Math.max(from, gap.from);
      if (overlap > 0) missing += overlap;
    }
    return { day, observed: round4((to - from - missing) / (to - from)) };
  });
}

/**
 * The window's coverage as one number, over the days that have an answer.
 * `null` when none of them do, which is what an install with no recorded cycles
 * has to say rather than 0.
 */
export function coverageOver(daily: readonly DayCoverage[]): number | null {
  const known = daily.filter((entry): entry is DayCoverage & { observed: number } => entry.observed !== null);
  if (known.length === 0) return null;
  return round4(known.reduce((sum, entry) => sum + entry.observed, 0) / known.length);
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
