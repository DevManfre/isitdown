import type { SeriesPoint } from "./types.ts";

/**
 * The operator's metric drawn under the incidents — roadmap 6.11. Pure, so the
 * line and the sentence under it can be tested without a browser.
 */

/** An incident's window on the shared axis, in epoch milliseconds. */
export interface Window {
  startMs: number;
  endMs: number;
  providerId: string;
  name: string;
}

/**
 * The polyline's `points` in a 1000×100 box, y growing down, scaled from zero
 * (or the lowest value, if it is negative) to the highest. A flat series sits
 * on the floor rather than being stretched into noise.
 */
export function metricLine(points: readonly SeriesPoint[], fromMs: number, toMs: number): { points: string; max: number; min: number } {
  if (points.length === 0) return { points: "", max: 0, min: 0 };
  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const width = toMs - fromMs || 1;
  const coords = points.map((point) => {
    const x = ((Date.parse(point.at) - fromMs) / width) * 1000;
    const y = 100 - ((point.value - min) / span) * 100;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return { points: coords.join(" "), max, min };
}

export interface MetricConclusion {
  peak: SeriesPoint;
  /** The incident running at the peak's moment, if any. */
  during: Window | null;
}

/**
 * Where the series peaked and whether a provider incident was running then —
 * the sentence a reader who cannot see the chart still gets.
 */
export function metricConclusion(points: readonly SeriesPoint[], windows: readonly Window[]): MetricConclusion | null {
  if (points.length === 0) return null;
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best));
  const at = Date.parse(peak.at);
  const during = windows.find((window) => window.startMs <= at && at <= window.endMs) ?? null;
  return { peak, during };
}
