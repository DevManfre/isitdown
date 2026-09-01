import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BentoTile } from "@/components/BentoTile.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { DottedWorld } from "@/components/charts/DottedWorld.tsx";
import { useMap, usePreferences } from "@/hooks/queries.ts";
import { binPoints, CELL_DEGREES, type MapCell } from "@/lib/mapCells.ts";
import { formatRelative } from "@/lib/format.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The incident detail's geographic tile: where the provider this incident
 * belongs to physically runs, and the state its locations are in.
 *
 * It is deliberately *not* the incident's epicentre. The incident payload
 * (`/incidents/:providerId/:incidentId`) carries no affected-component list, so
 * there is nothing to place a fault pin from — what the map snapshot does know
 * is each located component's current status, so a PoP that is degraded right
 * now already draws as a fault cell. Claiming more than that would be inventing
 * geography the adapter never reported.
 *
 * Always the dotted map, never the globe, whichever view the operator picked
 * for the Overview: `StatusGlobe` is a fixed 480px canvas, and a globe shrunk
 * into a tile shows one hemisphere with its markers fused. The `mapView`
 * preference is still honoured as an on/off switch — an operator who turned the
 * map off gets no tile here either, and no request is issued.
 */
export function IncidentMap({
  providerId,
  providerName,
  delay,
  className,
}: {
  providerId: string;
  providerName: string;
  delay: string;
  /** Required, not optional: how wide the tile sits is the grid's business at
   *  the call site, exactly as for every other tile on the page. */
  className: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const view = usePreferences().data?.mapView ?? "off";
  const { data, isError, isPending } = useMap(view !== "off");

  // This provider's own points, before binning: the fleet's other providers
  // would put markers on a map captioned with this one's name.
  const points = useMemo(
    () => (data?.points ?? []).filter((point) => point.providerId === providerId),
    [data?.points, providerId],
  );
  const cells: MapCell[] = useMemo(() => binPoints(points, CELL_DEGREES), [points]);

  if (view === "off") return null;

  const unplaced = (data?.unlocated ?? [])
    .filter((entry) => entry.providerId === providerId)
    .reduce((sum, entry) => sum + entry.count, 0);

  return (
    <BentoTile title={t("incident.map.title", { name: providerName })} delay={delay} className={className}>
      {isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("map.error")}
        </p>
      ) : isPending ? null : points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("incident.map.empty", { name: providerName })}</p>
      ) : (
        <TooltipProvider>
          {/* `aspect-[2/1]` rather than a fixed height: it is the equirectangular
              grid's own ratio, so the map fills the tile at whatever width the
              column gives it instead of letterboxing inside it. At 3 of the
              grid's 6 columns that is ~580px wide — comfortably above the
              ~370px where the Overview's card found the coastline dissolving. */}
          <div className="aspect-[2/1]">
            <DottedWorld cells={cells} onSelect={() => navigate(ROUTE_PATHS.providers)} />
          </div>
        </TooltipProvider>
      )}

      {points.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("map.footnote", { count: points.length, unplaced })}
          {data?.generatedAt != null && (
            <span className="block">
              {t("map.footnote.age", { age: formatRelative(i18n.language, data.generatedAt) })}
            </span>
          )}
        </p>
      )}
    </BentoTile>
  );
}
