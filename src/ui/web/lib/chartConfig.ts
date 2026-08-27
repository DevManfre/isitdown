import type { OverallStatus } from "./types.ts";

/**
 * The chart layer's whole knowledge of status.
 *
 * Token names are listed rather than built from the status string: a name
 * assembled at runtime cannot be checked against tokens.css, and the guard
 * test that keeps every colour in the token file would have nothing to
 * look at.
 *
 * `bar` is a severity weight, not a pixel height — Recharts scales it. A worse
 * status draws a taller bar; `unknown` draws the shortest, because "not
 * measured" must not read louder than "down".
 */
export const STATUS_CHART = {
  operational: {
    labelKey: "status.operational",
    color: "var(--status-operational)",
    fill: "var(--status-operational-fill)",
    bar: 40,
  },
  degraded: {
    labelKey: "status.degraded",
    color: "var(--status-degraded)",
    fill: "var(--status-degraded-fill)",
    bar: 62,
  },
  partial_outage: {
    labelKey: "status.partial-outage",
    color: "var(--status-partial-outage)",
    fill: "var(--status-partial-outage-fill)",
    bar: 80,
  },
  major_outage: {
    labelKey: "status.major-outage",
    color: "var(--status-major-outage)",
    fill: "var(--status-major-outage-fill)",
    bar: 100,
  },
  unknown: {
    labelKey: "status.unknown",
    color: "var(--status-unknown)",
    fill: "var(--status-unknown-fill)",
    bar: 26,
  },
} as const satisfies Record<OverallStatus, { labelKey: string; color: string; fill: string; bar: number }>;

/**
 * The Overview's dense shape draws one ring for the fleet's average uptime.
 * That is not a status — no provider is "average" — so it must not take a
 * STATUS_CHART colour: green would read as "everything is operational".
 * `--status-accent` is the token declared for exactly this, a chart mark that
 * reads as the product's accent rather than as a severity.
 */
export const AGGREGATE_FILL = "var(--status-accent)";

/** Which of the three bar rows a chart belongs to; each has its own scale. */
export type BarScale = "row" | "compact" | "poll";

const SCALE: Record<BarScale, number> = { row: 1, compact: 0.42, poll: 0.55 };

const known = (status: string): OverallStatus =>
  Object.hasOwn(STATUS_CHART, status) ? (status as OverallStatus) : "unknown";

export const severity = (status: string, scale: BarScale = "row") =>
  STATUS_CHART[known(status)].bar * SCALE[scale];

export const statusColor = (status: string) => STATUS_CHART[known(status)].color;
export const statusFill = (status: string) => STATUS_CHART[known(status)].fill;
export const statusLabelKey = (status: string) => STATUS_CHART[known(status)].labelKey;
/** `unknown` is drawn faded: never measured is not the same claim as down. */
export const statusMuted = (status: string) => known(status) === "unknown";

/**
 * The three colours an operator reads at a glance, plus "not measured".
 *
 * The five statuses carry the detail; a tier carries the verdict. `degraded`
 * and `partial_outage` share the warning tier deliberately — keeping red for
 * `major_outage` alone is what makes red mean something when it appears.
 */
export type StatusTier = "ok" | "warn" | "danger" | "unknown";

const TIER: Record<OverallStatus, StatusTier> = {
  operational: "ok",
  degraded: "warn",
  partial_outage: "warn",
  major_outage: "danger",
  unknown: "unknown",
};

/** Which tier a tier outranks. The beacon shows the highest one present. */
const TIER_RANK: Record<StatusTier, number> = { ok: 0, unknown: 1, warn: 2, danger: 3 };

const TIER_STATUS: Record<StatusTier, OverallStatus> = {
  ok: "operational",
  warn: "degraded",
  danger: "major_outage",
  unknown: "unknown",
};

export const statusTier = (status: string): StatusTier => TIER[known(status)];

/** The tier's colour is a status colour, so it stays a token like every other. */
export const tierColor = (tier: StatusTier): string => statusColor(TIER_STATUS[tier]);

/**
 * The worst tier across a set of providers — what the Overview headline is
 * already saying in words, as one colour.
 *
 * `unknown` outranks `ok` rather than sitting below it: the headline counts a
 * never-measured provider as not operational, and a green beacon beside that
 * sentence would contradict it. It stays below a real fault, because "we did
 * not measure" is not "it is down".
 */
export const worstTier = (statuses: string[]): StatusTier =>
  statuses.length === 0
    ? "unknown"
    : statuses
        .map(statusTier)
        .reduce((worst, tier) => (TIER_RANK[tier] > TIER_RANK[worst] ? tier : worst), "ok");

/**
 * The shadcn chart config, so a tooltip and a legend read the same colours.
 * `label` is a catalog key: whoever renders it resolves it with `t()`.
 *
 * Typed structurally rather than as shadcn's `ChartConfig`, because this module
 * is also imported by a `node --test` suite that cannot resolve `@/` aliases.
 */
export function chartConfigFor(
  _scale: BarScale = "row",
): Record<string, { label: string; color: string }> {
  return Object.fromEntries(
    Object.entries(STATUS_CHART).map(([status, spec]) => [
      status,
      { label: spec.labelKey, color: spec.fill },
    ]),
  );
}

/**
 * Keeps only the newest `size` entries of a newest-first list — what a strip
 * chart does before it draws.
 *
 * It lived in `favicon.ts` for no reason other than that both helpers came off
 * charts.js in the same pass; nothing about it has to do with favicons, and a
 * test importing a list helper from a favicon module is how that stays hidden.
 */
export const trimToLatest = <T>(list: T[], size: number): T[] => list.slice(0, size);
