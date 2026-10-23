import type { ReactElement } from "react";
import { Trans, useTranslation } from "react-i18next";
import { FleetGroups } from "@/components/FleetGroups.tsx";
import { FleetRings } from "@/components/FleetRings.tsx";
import { FLEET_ROW_STAGGER, FleetRows } from "@/components/FleetRows.tsx";
import { GeoCard } from "@/components/GeoCard.tsx";
import { SharedFailureCard } from "@/components/SharedFailureCard.tsx";
import { StackBand } from "@/components/StackBand.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { useConfigChrome, useStatus } from "@/hooks/queries.ts";
import { sharedFailure } from "@/lib/sharedFailure.ts";
import { stagger } from "@/lib/stagger.ts";
import {
  WIDGET_PROPS,
  WIDGET_WIDTHS,
  type PropKind,
  type FleetFilter,
  type Width,
  type WidgetConfig,
  type WidgetType,
} from "../../dashboardLayout.ts";
import { useFleetSlice } from "./useFleetSlice.ts";
import { OpenIncidents } from "./catalog/OpenIncidents.tsx";
import { Maintenances } from "./catalog/Maintenances.tsx";
import { ErrorBudget } from "./catalog/ErrorBudget.tsx";
import { ProviderTile } from "./catalog/ProviderTile.tsx";
import { Sparklines } from "./catalog/Sparklines.tsx";
import { YearCalendar } from "./catalog/YearCalendar.tsx";
import { WeekdayHours } from "./catalog/WeekdayHours.tsx";
import { Reliability } from "./catalog/Reliability.tsx";
import { Annotations } from "./catalog/Annotations.tsx";
import { Delivery } from "./catalog/Delivery.tsx";
import { Heartbeats } from "./catalog/Heartbeats.tsx";
import { Coincidence } from "./catalog/Coincidence.tsx";

/**
 * The composable Overview's widgets — roadmap 4.1.
 *
 * Every widget is an existing Overview block behind a thin wrapper that reads
 * its own slice of the fleet: none draws anything the Overview did not already
 * draw, and with an empty filter each draws exactly what it drew before. A
 * widget with nothing to show returns `null`, and its grid cell collapses —
 * the Overview's blocks always hid themselves that way.
 */
type PropsOf<T extends WidgetType> = Extract<WidgetConfig, { type: T }>["props"];

export interface WidgetDef<T extends WidgetType> {
  type: T;
  titleKey: string;
  /** One line in the catalogue. */
  descriptionKey: string;
  /** Why it draws nothing right now — the placeholder edit mode shows in its place. */
  idleKey: string;
  widths: readonly Width[];
  /** What the widget can be pointed at — the edit toolbar offers a filter or a provider picker accordingly. */
  props: PropKind;
  Component: (props: { props: PropsOf<T> }) => ReactElement | null;
}

function EmptySlice() {
  const { t } = useTranslation();
  return (
    <p
      data-slot="widget-empty-slice"
      className="rounded-lg border border-dashed border-border px-5 py-4 text-sm text-muted-foreground"
    >
      {t("dashboard.empty-slice")}
    </p>
  );
}

function FleetRingsWidget({ props }: { props: { filter: FleetFilter } }) {
  const slice = useFleetSlice(props.filter);
  if (slice.empty) return <EmptySlice />;
  // A dense fleet folds its tiles into the hero's one figure; the rings only
  // come back for a slice small enough to draw them.
  if (slice.shape === "dense" || slice.providers.length === 0) return null;
  return <FleetRings providers={slice.providers} shape={slice.shape} />;
}

function GeoMapWidget() {
  return <GeoCard />;
}

function SharedFailureWidget() {
  const { data: status } = useStatus();
  const { data: config } = useConfigChrome();
  const configured = status?.providers ?? [];
  const shared = sharedFailure(
    configured.filter((provider) => provider.enabled),
    new Map(
      (config?.services ?? []).flatMap((service) =>
        service.dependsOn == null ? [] : [[service.id, service.dependsOn] as const],
      ),
    ),
  );
  if (shared === null) return null;
  return (
    <SharedFailureCard failure={shared} nameOf={(id) => configured.find((p) => p.id === id)?.name ?? id} />
  );
}

function StackBandWidget({ props }: { props: { filter: FleetFilter } }) {
  const slice = useFleetSlice(props.filter);
  if (slice.empty) return <EmptySlice />;
  return <StackBand groups={slice.groups} providers={slice.providers} />;
}

function FleetListWidget({ props }: { props: { filter: FleetFilter } }) {
  const { i18n } = useTranslation();
  const slice = useFleetSlice(props.filter);
  if (slice.empty) return <EmptySlice />;
  // Nothing configured, or nothing enabled: the Overview says so once, in its
  // own fixed line under the grid — not once per fleet widget.
  if (slice.providers.length === 0) return null;
  return (
    <>
      {slice.shape === "dense" ? (
        <FleetGroups providers={slice.providers} buckets={slice.buckets} />
      ) : (
        <FleetRows providers={slice.providers} buckets={slice.buckets} />
      )}
      <div
        className="anim-fade mt-4 text-sm text-muted-foreground"
        style={{ animationDelay: stagger(slice.providers.length, FLEET_ROW_STAGGER) }}
      >
        <Trans
          i18nKey="overview.uptime-window"
          values={{ uptime: slice.average }}
          components={[
            <NumberTicker locale={i18n.language} value={slice.average} decimalPlaces={2} suffix="%" />,
          ]}
        />
      </div>
    </>
  );
}

export const WIDGETS: { [T in WidgetType]: WidgetDef<T> } = {
  "fleet-rings": {
    type: "fleet-rings",
    titleKey: "dashboard.widget.fleet-rings.title",
    descriptionKey: "dashboard.widget.fleet-rings.description",
    idleKey: "dashboard.widget.fleet-rings.idle",
    widths: WIDGET_WIDTHS["fleet-rings"],
    props: WIDGET_PROPS["fleet-rings"],
    Component: FleetRingsWidget,
  },
  "geo-map": {
    type: "geo-map",
    titleKey: "dashboard.widget.geo-map.title",
    descriptionKey: "dashboard.widget.geo-map.description",
    idleKey: "dashboard.widget.geo-map.idle",
    widths: WIDGET_WIDTHS["geo-map"],
    props: WIDGET_PROPS["geo-map"],
    Component: GeoMapWidget,
  },
  "shared-failure": {
    type: "shared-failure",
    titleKey: "dashboard.widget.shared-failure.title",
    descriptionKey: "dashboard.widget.shared-failure.description",
    idleKey: "dashboard.widget.shared-failure.idle",
    widths: WIDGET_WIDTHS["shared-failure"],
    props: WIDGET_PROPS["shared-failure"],
    Component: SharedFailureWidget,
  },
  "stack-band": {
    type: "stack-band",
    titleKey: "dashboard.widget.stack-band.title",
    descriptionKey: "dashboard.widget.stack-band.description",
    idleKey: "dashboard.widget.stack-band.idle",
    widths: WIDGET_WIDTHS["stack-band"],
    props: WIDGET_PROPS["stack-band"],
    Component: StackBandWidget,
  },
  "fleet-list": {
    type: "fleet-list",
    titleKey: "dashboard.widget.fleet-list.title",
    descriptionKey: "dashboard.widget.fleet-list.description",
    idleKey: "dashboard.widget.fleet-list.idle",
    widths: WIDGET_WIDTHS["fleet-list"],
    props: WIDGET_PROPS["fleet-list"],
    Component: FleetListWidget,
  },
  "open-incidents": {
    type: "open-incidents",
    titleKey: "dashboard.widget.open-incidents.title",
    descriptionKey: "dashboard.widget.open-incidents.description",
    idleKey: "dashboard.widget.open-incidents.idle",
    widths: WIDGET_WIDTHS["open-incidents"],
    props: WIDGET_PROPS["open-incidents"],
    Component: OpenIncidents,
  },
  maintenances: {
    type: "maintenances",
    titleKey: "dashboard.widget.maintenances.title",
    descriptionKey: "dashboard.widget.maintenances.description",
    idleKey: "dashboard.widget.maintenances.idle",
    widths: WIDGET_WIDTHS["maintenances"],
    props: WIDGET_PROPS["maintenances"],
    Component: Maintenances,
  },
  "error-budget": {
    type: "error-budget",
    titleKey: "dashboard.widget.error-budget.title",
    descriptionKey: "dashboard.widget.error-budget.description",
    idleKey: "dashboard.widget.error-budget.idle",
    widths: WIDGET_WIDTHS["error-budget"],
    props: WIDGET_PROPS["error-budget"],
    Component: ErrorBudget,
  },
  "provider-tile": {
    type: "provider-tile",
    titleKey: "dashboard.widget.provider-tile.title",
    descriptionKey: "dashboard.widget.provider-tile.description",
    idleKey: "dashboard.widget.provider-tile.idle",
    widths: WIDGET_WIDTHS["provider-tile"],
    props: WIDGET_PROPS["provider-tile"],
    Component: ProviderTile,
  },
  sparklines: {
    type: "sparklines",
    titleKey: "dashboard.widget.sparklines.title",
    descriptionKey: "dashboard.widget.sparklines.description",
    idleKey: "dashboard.widget.sparklines.idle",
    widths: WIDGET_WIDTHS["sparklines"],
    props: WIDGET_PROPS["sparklines"],
    Component: Sparklines,
  },
  "year-calendar": {
    type: "year-calendar",
    titleKey: "dashboard.widget.year-calendar.title",
    descriptionKey: "dashboard.widget.year-calendar.description",
    idleKey: "dashboard.widget.year-calendar.idle",
    widths: WIDGET_WIDTHS["year-calendar"],
    props: WIDGET_PROPS["year-calendar"],
    Component: YearCalendar,
  },
  "weekday-hours": {
    type: "weekday-hours",
    titleKey: "dashboard.widget.weekday-hours.title",
    descriptionKey: "dashboard.widget.weekday-hours.description",
    idleKey: "dashboard.widget.weekday-hours.idle",
    widths: WIDGET_WIDTHS["weekday-hours"],
    props: WIDGET_PROPS["weekday-hours"],
    Component: WeekdayHours,
  },
  reliability: {
    type: "reliability",
    titleKey: "dashboard.widget.reliability.title",
    descriptionKey: "dashboard.widget.reliability.description",
    idleKey: "dashboard.widget.reliability.idle",
    widths: WIDGET_WIDTHS["reliability"],
    props: WIDGET_PROPS["reliability"],
    Component: Reliability,
  },
  annotations: {
    type: "annotations",
    titleKey: "dashboard.widget.annotations.title",
    descriptionKey: "dashboard.widget.annotations.description",
    idleKey: "dashboard.widget.annotations.idle",
    widths: WIDGET_WIDTHS["annotations"],
    props: WIDGET_PROPS["annotations"],
    Component: Annotations,
  },
  delivery: {
    type: "delivery",
    titleKey: "dashboard.widget.delivery.title",
    descriptionKey: "dashboard.widget.delivery.description",
    idleKey: "dashboard.widget.delivery.idle",
    widths: WIDGET_WIDTHS["delivery"],
    props: WIDGET_PROPS["delivery"],
    Component: Delivery,
  },
  heartbeats: {
    type: "heartbeats",
    titleKey: "dashboard.widget.heartbeats.title",
    descriptionKey: "dashboard.widget.heartbeats.description",
    idleKey: "dashboard.widget.heartbeats.idle",
    widths: WIDGET_WIDTHS["heartbeats"],
    props: WIDGET_PROPS["heartbeats"],
    Component: Heartbeats,
  },
  coincidence: {
    type: "coincidence",
    titleKey: "dashboard.widget.coincidence.title",
    descriptionKey: "dashboard.widget.coincidence.description",
    idleKey: "dashboard.widget.coincidence.idle",
    widths: WIDGET_WIDTHS["coincidence"],
    props: WIDGET_PROPS["coincidence"],
    Component: Coincidence,
  },
};

/** The catalogue's order: the order the default Overview draws them in. */
export const WIDGET_ORDER: readonly WidgetType[] = [
  "fleet-rings",
  "geo-map",
  "shared-failure",
  "stack-band",
  "fleet-list",
  // The catalogue's second round, by the question it answers: what needs me
  // now, what is coming, how is the record, and is the alerting itself alive.
  "open-incidents",
  "provider-tile",
  "heartbeats",
  "maintenances",
  "error-budget",
  "sparklines",
  "year-calendar",
  "reliability",
  "weekday-hours",
  "coincidence",
  "annotations",
  "delivery",
];
