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
  WIDGET_WIDTHS,
  type FleetFilter,
  type Width,
  type WidgetConfig,
  type WidgetType,
} from "../../dashboardLayout.ts";
import { useFleetSlice } from "./useFleetSlice.ts";

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
  /** Whether the widget takes a fleet filter. */
  filterable: boolean;
  defaultProps: PropsOf<T>;
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

const wholeFleet = (): { filter: FleetFilter } => ({ filter: { groups: [], providers: [] } });

export const WIDGETS: { [T in WidgetType]: WidgetDef<T> } = {
  "fleet-rings": {
    type: "fleet-rings",
    titleKey: "dashboard.widget.fleet-rings.title",
    descriptionKey: "dashboard.widget.fleet-rings.description",
    idleKey: "dashboard.widget.fleet-rings.idle",
    widths: WIDGET_WIDTHS["fleet-rings"],
    filterable: true,
    defaultProps: wholeFleet(),
    Component: FleetRingsWidget,
  },
  "geo-map": {
    type: "geo-map",
    titleKey: "dashboard.widget.geo-map.title",
    descriptionKey: "dashboard.widget.geo-map.description",
    idleKey: "dashboard.widget.geo-map.idle",
    widths: WIDGET_WIDTHS["geo-map"],
    filterable: false,
    defaultProps: {},
    Component: GeoMapWidget,
  },
  "shared-failure": {
    type: "shared-failure",
    titleKey: "dashboard.widget.shared-failure.title",
    descriptionKey: "dashboard.widget.shared-failure.description",
    idleKey: "dashboard.widget.shared-failure.idle",
    widths: WIDGET_WIDTHS["shared-failure"],
    filterable: false,
    defaultProps: {},
    Component: SharedFailureWidget,
  },
  "stack-band": {
    type: "stack-band",
    titleKey: "dashboard.widget.stack-band.title",
    descriptionKey: "dashboard.widget.stack-band.description",
    idleKey: "dashboard.widget.stack-band.idle",
    widths: WIDGET_WIDTHS["stack-band"],
    filterable: true,
    defaultProps: wholeFleet(),
    Component: StackBandWidget,
  },
  "fleet-list": {
    type: "fleet-list",
    titleKey: "dashboard.widget.fleet-list.title",
    descriptionKey: "dashboard.widget.fleet-list.description",
    idleKey: "dashboard.widget.fleet-list.idle",
    widths: WIDGET_WIDTHS["fleet-list"],
    filterable: true,
    defaultProps: wholeFleet(),
    Component: FleetListWidget,
  },
};

/** The catalogue's order: the order the default Overview draws them in. */
export const WIDGET_ORDER: readonly WidgetType[] = [
  "fleet-rings",
  "geo-map",
  "shared-failure",
  "stack-band",
  "fleet-list",
];
