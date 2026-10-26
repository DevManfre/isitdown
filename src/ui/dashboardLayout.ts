/**
 * The composable Overview's layout — roadmap 4.1.
 *
 * Shapes and constants only, shared by the server and the dashboard. The zod
 * schema that checks a layout lives beside it in `dashboardLayoutSchema.ts`,
 * which only the server imports: the dashboard draws what the server already
 * validated, and zod would cost it ~8 kB gzipped for nothing.
 *
 * A layout is an ordered list, not a 2D grid: height is always the widget's
 * own, and width is one of four steps on a 6-column grid.
 */
export const WIDTHS = ["full", "two-thirds", "half", "third"] as const;
export type Width = (typeof WIDTHS)[number];

/**
 * Widths each widget can take. The map has no third: it reads as a stripe.
 * Every catalogue widget takes all four — at a third each draws its summary,
 * not a squeezed copy of its full self.
 */
export const WIDGET_WIDTHS = {
  "fleet-rings": WIDTHS,
  "geo-map": ["full", "two-thirds", "half"],
  "shared-failure": WIDTHS,
  "stack-band": WIDTHS,
  "fleet-list": WIDTHS,
  "open-incidents": WIDTHS,
  maintenances: WIDTHS,
  "error-budget": WIDTHS,
  "provider-tile": WIDTHS,
  sparklines: WIDTHS,
  "year-calendar": WIDTHS,
  "weekday-hours": WIDTHS,
  reliability: WIDTHS,
  annotations: WIDTHS,
  delivery: WIDTHS,
  heartbeats: WIDTHS,
  coincidence: WIDTHS,
  // Roadmap 4.1's third round: twelve more, each reading an endpoint the
  // dashboard already calls.
  "page-delay": WIDTHS,
  suspected: WIDTHS,
  "stale-readings": WIDTHS,
  muted: WIDTHS,
  "page-honesty": WIDTHS,
  groups: WIDTHS,
  "degraded-components": WIDTHS,
  "recent-alerts": WIDTHS,
  "poller-pulse": WIDTHS,
  worsened: WIDTHS,
  noisy: WIDTHS,
  "who-to-call": WIDTHS,
} as const satisfies Record<string, readonly Width[]>;

export type WidgetType = keyof typeof WIDGET_WIDTHS;

/**
 * What a widget can be pointed at: a slice of the fleet, one provider, or
 * nothing — the props schema, the edit toolbar and a fresh widget's defaults
 * all follow from this one table.
 */
export const WIDGET_PROPS = {
  "fleet-rings": "fleet",
  "geo-map": "none",
  "shared-failure": "none",
  "stack-band": "fleet",
  "fleet-list": "fleet",
  "open-incidents": "fleet",
  maintenances: "fleet",
  "error-budget": "fleet",
  "provider-tile": "provider",
  sparklines: "fleet",
  "year-calendar": "provider",
  "weekday-hours": "none",
  reliability: "fleet",
  annotations: "none",
  delivery: "none",
  heartbeats: "none",
  coincidence: "none",
  "page-delay": "none",
  suspected: "fleet",
  "stale-readings": "fleet",
  muted: "none",
  "page-honesty": "none",
  groups: "none",
  "degraded-components": "fleet",
  "recent-alerts": "none",
  "poller-pulse": "none",
  worsened: "fleet",
  noisy: "fleet",
  "who-to-call": "fleet",
} as const satisfies Record<WidgetType, "fleet" | "provider" | "none">;

export type PropKind = (typeof WIDGET_PROPS)[WidgetType];
type TypesOf<K extends PropKind> = { [T in WidgetType]: (typeof WIDGET_PROPS)[T] extends K ? T : never }[WidgetType];

/** Most widgets one layout can hold; past this the grid stops being a summary. */
export const MAX_WIDGETS = 50;

/**
 * A union: the providers in any named group plus any named provider. Empty is
 * the whole fleet. Ids that no longer exist are kept — the dashboard draws them
 * as removed, rather than the server silently widening the filter.
 */
export interface FleetFilter {
  groups: string[];
  providers: string[];
}

/**
 * One provider, by id. `null` follows the fleet: whichever provider is worst
 * right now, so a tile left on its default always shows the one to look at.
 */
export interface ProviderPick {
  provider: string | null;
}

type FleetWidget<T extends WidgetType> = { id: string; type: T; width: Width; props: { filter: FleetFilter } };
type ProviderWidget<T extends WidgetType> = { id: string; type: T; width: Width; props: ProviderPick };
type PlainWidget<T extends WidgetType> = { id: string; type: T; width: Width; props: Record<string, never> };

export type WidgetConfig =
  | { [T in TypesOf<"fleet">]: FleetWidget<T> }[TypesOf<"fleet">]
  | { [T in TypesOf<"provider">]: ProviderWidget<T> }[TypesOf<"provider">]
  | { [T in TypesOf<"none">]: PlainWidget<T> }[TypesOf<"none">];

export interface DashboardLayout {
  version: 1;
  widgets: WidgetConfig[];
}

const wholeFleet = (): { filter: FleetFilter } => ({ filter: { groups: [], providers: [] } });

/**
 * Today's Overview, block for block. A dashboard that was never customised
 * stores NULL and is served this, so blocks added here by later releases reach
 * every operator who has not chosen otherwise.
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { id: "rings", type: "fleet-rings", width: "full", props: wholeFleet() },
    { id: "map", type: "geo-map", width: "full", props: {} },
    { id: "shared", type: "shared-failure", width: "full", props: {} },
    { id: "stack", type: "stack-band", width: "full", props: wholeFleet() },
    { id: "fleet", type: "fleet-list", width: "full", props: wholeFleet() },
  ],
};
