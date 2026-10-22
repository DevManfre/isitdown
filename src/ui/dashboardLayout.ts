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

/** Widths each widget can take. The map has no third: it reads as a stripe. */
export const WIDGET_WIDTHS = {
  "fleet-rings": WIDTHS,
  "geo-map": ["full", "two-thirds", "half"],
  "shared-failure": WIDTHS,
  "stack-band": WIDTHS,
  "fleet-list": WIDTHS,
} as const satisfies Record<string, readonly Width[]>;

export type WidgetType = keyof typeof WIDGET_WIDTHS;

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

type FleetWidget<T extends WidgetType> = { id: string; type: T; width: Width; props: { filter: FleetFilter } };
type PlainWidget<T extends WidgetType> = { id: string; type: T; width: Width; props: Record<string, never> };

export type WidgetConfig =
  | FleetWidget<"fleet-rings">
  | PlainWidget<"geo-map">
  | PlainWidget<"shared-failure">
  | FleetWidget<"stack-band">
  | FleetWidget<"fleet-list">;

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
