/**
 * What "usually" means for a status page's answer time — roadmap 1.10.
 *
 * A page that goes from 200 ms to 4 s is often the first sign of trouble,
 * before the provider says anything. The band below is deliberately plain
 * statistics — a rolling median and the median absolute deviation around it —
 * because both are robust to the very spikes they are asked to spot: one 9 s
 * outlier in the window moves neither, where a mean and a standard deviation
 * would both drift towards it and start excusing the next one.
 */

/** Readings a page's band is built from: the most recent ones, oldest dropped first. */
export const LATENCY_WINDOW = 60;
/**
 * Readings needed before the band says anything. Twenty polls is an hour at the
 * three-minute default — short enough to start judging on a fresh install, long
 * enough that one slow afternoon is not the definition of normal.
 */
export const MIN_LATENCY_SAMPLES = 20;
/**
 * How many scaled MADs above the median a reading has to land. Six is far out:
 * this is an alert, and a page that is merely having a jittery hour is not news.
 */
const MAD_FACTOR = 6;
/** Makes a MAD comparable to a standard deviation on normally distributed data. */
const MAD_SCALE = 1.4826;
/**
 * Two floors on top of the band, both about a page that barely ever varies:
 * its MAD is near zero, so a band on its own would call 90 ms against a usual
 * 60 ms an anomaly. A reading has to be several times the median *and* slower
 * by a margin a person would notice.
 */
const MIN_RATIO = 3;
const MIN_EXCESS_MS = 1000;

export interface LatencyBand {
  medianMs: number;
  /** The answer time a reading has to exceed to count as slow. */
  thresholdMs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The band a page's recent readings describe, or null while there are too few to describe one. */
export function latencyBand(samples: readonly number[]): LatencyBand | null {
  const usable = samples.filter((sample) => Number.isFinite(sample) && sample >= 0);
  if (usable.length < MIN_LATENCY_SAMPLES) return null;
  const medianMs = median(usable);
  const madMs = median(usable.map((sample) => Math.abs(sample - medianMs)));
  const thresholdMs = Math.max(
    medianMs + MAD_FACTOR * MAD_SCALE * madMs,
    medianMs * MIN_RATIO,
    medianMs + MIN_EXCESS_MS,
  );
  return { medianMs: Math.round(medianMs), thresholdMs: Math.round(thresholdMs) };
}

/** Appends a reading and drops whatever falls out of the window. */
export function pushLatency(samples: readonly number[], latencyMs: number): number[] {
  return [...samples, latencyMs].slice(-LATENCY_WINDOW);
}
