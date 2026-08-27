/**
 * How the Overview presents its fleet, as a function of how large that fleet
 * is — the one place the thresholds live.
 *
 * The two decisions the view makes are deliberately split by source. Column
 * count and tile width come from CSS (`auto-fill minmax(…)`), so they follow
 * the viewport: fourteen providers fit one band row on a wide screen and two
 * on a laptop, and neither case needs a threshold here. What this function
 * decides is the *qualitative* change — where the rings live, and whether the
 * list is flat or grouped by severity — which depends on the count alone.
 *
 * Only three shapes, because the third already scales without bound: `dense`
 * draws a fixed-height hero and folds the operational fleet into one strip of
 * dots, so it reads the same at fifteen providers and at two hundred.
 */
export type OverviewShape = "compact" | "band" | "dense";

/** Largest fleet a 3-column ring grid draws in two rows beside the hero copy. */
const COMPACT_MAX = 6;

/** Largest fleet the full-width 56px ring band draws without a third row. */
const BAND_MAX = 14;

export function overviewShape(count: number): OverviewShape {
  const providers = Math.floor(count);
  if (providers <= COMPACT_MAX) return "compact";
  if (providers <= BAND_MAX) return "band";
  return "dense";
}
