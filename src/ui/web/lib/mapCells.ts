import type { MapPoint, OverallStatus } from "./types.ts";
import { statusTier, worstStatus } from "./chartConfig.ts";

/**
 * Cell size in degrees. Settled by looking at the prototype in `design/`: small
 * enough that Cloudflare's European PoPs stay several distinct cells rather
 * than one blob, large enough that the map does not become the 450 overlapping
 * markers the aggregation exists to avoid. Measured against the rendered
 * prototype, 4° yields 271 markers for the fleet, not the ~80 an earlier draft
 * of the plan assumed.
 */
export const CELL_DEGREES = 4;

export interface MapCell {
  /** Centroid of the cell's points, not the cell's geometric centre. */
  lat: number;
  lon: number;
  count: number;
  worst: OverallStatus;
  points: MapPoint[];
}

/**
 * Marker radius from a cell's count.
 *
 * Settled against the rendered prototype, not guessed: at 4° the cell pitch is
 * 9.78px, so a radius of 9 spans 1.84 cells — neighbouring markers fuse and a
 * red cell is swallowed by its operational neighbours. 5 is 0.51 of a cell,
 * which is the largest a marker can be and still leave its cell readable.
 *
 * `sqrt` rather than linear so a cell of 40 reads as bigger than a cell of 4
 * without being ten times the area.
 */
export const markerRadius = (count: number): number =>
  Math.min(5, Math.max(2, 2 * Math.sqrt(count)));

/**
 * Groups points into a lat/lon grid so a fleet of hundreds of edge locations
 * draws as a couple hundred markers instead of overlapping every one of them.
 *
 * Binning is by floor, not by rounding: `floor` puts every longitude in exactly
 * one cell with no seam, where rounding folds 179 and -179 into the same
 * bucket — the antimeridian is where a naive grid quietly goes wrong.
 *
 * A cell's position is the centroid of its own points rather than the cell's
 * centre: a single PoP should be drawn where it is, not nudged to a grid node.
 */
export function binPoints(points: MapPoint[], cellDegrees: number = CELL_DEGREES): MapCell[] {
  const buckets = new Map<string, MapPoint[]>();
  for (const point of points) {
    const row = Math.floor(point.lat / cellDegrees);
    const column = Math.floor(point.lon / cellDegrees);
    const key = `${row}:${column}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [point]);
    else bucket.push(point);
  }

  return [...buckets.entries()]
    // Sorted by key so the render order does not depend on the order the
    // server happened to return points in — an unstable order makes a diff of
    // two screenshots unreadable.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, bucket]) => ({
      lat: bucket.reduce((sum, point) => sum + point.lat, 0) / bucket.length,
      lon: bucket.reduce((sum, point) => sum + point.lon, 0) / bucket.length,
      count: bucket.length,
      // chartConfig owns the severity ordering — a second ranking here is
      // exactly the drift its "the chart layer's whole knowledge of status"
      // comment exists to prevent.
      worst: worstStatus(bucket.map((point) => point.status)),
      points: bucket,
    }));
}

/** Re-exported so a component never assembles a tier itself. */
export { statusTier };
