import type { OverallStatus, ProviderStatus } from "./types.ts";

/**
 * What the browser tab says about the fleet — roadmap 5.10.
 *
 * The dashboard is a page an operator leaves open in a background tab for
 * days, so the tab strip is where they will see trouble first: a red dot and a
 * count, with no window to switch to.
 *
 * The reading is deliberately narrower than the Overview's. `unknown` does not
 * count as trouble: it is what a provider we have never read successfully
 * looks like, and a fresh instance whose first cycle has not landed must not
 * open with an alarming tab. Disabled providers do not count either — they are
 * off the dashboard, so they cannot be its headline.
 */

/** Severity order, worst last. `unknown` sorts below operational: see above. */
const RANK: Record<OverallStatus, number> = {
  unknown: 0,
  operational: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/** A status the tab is worth changing for. */
const isTrouble = (status: OverallStatus): boolean => RANK[status] > RANK.operational;

/**
 * Which token carries each status's dot colour. Listed rather than built from
 * the status string, exactly as `chartConfig`'s are: a name assembled at
 * runtime cannot be checked against tokens.css.
 */
const FILL_TOKEN: Record<OverallStatus, string> = {
  operational: "--status-operational-fill",
  degraded: "--status-degraded-fill",
  partial_outage: "--status-partial-outage-fill",
  major_outage: "--status-major-outage-fill",
  unknown: "--status-unknown-fill",
};

/**
 * What the dot falls back to when the token cannot be read — a favicon is
 * rendered by the browser chrome, where no stylesheet of ours applies, so the
 * generated SVG has to carry a literal colour either way. These are the light
 * palette's own `-fill` values, which read as the same severity on a dark tab
 * strip as on a light one. Exported so a test asserts against these rather
 * than repeating the literals — a second copy is how the two drift.
 */
export const STATUS_FALLBACK_FILL: Record<OverallStatus, string> = {
  operational: "#16a34a",
  degraded: "#bd8404",
  partial_outage: "#ea580c",
  major_outage: "#dc2626",
  unknown: "#8e8e96",
};

export interface FleetStatus {
  /** The worst status any enabled provider is in, `operational` when none is. */
  worst: OverallStatus;
  /** How many enabled providers are in trouble. Zero while the fleet is calm. */
  affected: number;
}

export function fleetStatus(providers: ProviderStatus[]): FleetStatus {
  const troubled = providers.filter((provider) => provider.enabled && isTrouble(provider.overallStatus));
  const worst = troubled.reduce<OverallStatus>(
    (worstSoFar, provider) =>
      RANK[provider.overallStatus] > RANK[worstSoFar] ? provider.overallStatus : worstSoFar,
    "operational",
  );
  return { worst, affected: troubled.length };
}

/** The colour the dot is drawn in: the semantic token, or its literal fallback. */
export function statusFill(status: OverallStatus, element: Element = document.documentElement): string {
  const raw = getComputedStyle(element).getPropertyValue(FILL_TOKEN[status]).trim();
  return raw === "" ? STATUS_FALLBACK_FILL[status] : raw;
}

/**
 * The brand mark with a status dot on it, as a data URI.
 *
 * The mark's geometry is `public/favicon.svg`'s, kept in sync by hand — the
 * same hand-sync note that file already carries for `BrandMark.tsx`. It cannot
 * come from either: this one is built at runtime, from a status, and a
 * `<link rel="icon">` cannot point at a React component.
 *
 * The dot is drawn bottom-right, ringed in white so it stays legible against
 * the mark's own gradient at 16px.
 */
export function faviconDataUri(status: OverallStatus, fill: string = statusFill(status)): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<defs><linearGradient id="mark" x1="0.15" y1="0" x2="0.85" y2="1">',
    '<stop offset="0" stop-color="#968ae0"/><stop offset="0.7" stop-color="#5d5294"/>',
    "</linearGradient></defs>",
    '<rect width="64" height="64" rx="16" fill="url(#mark)"/>',
    '<g transform="translate(13.14 13.14) scale(1.5714)">',
    '<path d="M2 12h4l2.5-6 3.5 12 3-8 2 2h5" fill="none" stroke="#fff" stroke-width="2.1"',
    ' stroke-linecap="round" stroke-linejoin="round"/></g>',
    `<circle cx="46" cy="46" r="15" fill="${fill}" stroke="#fff" stroke-width="5"/>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
