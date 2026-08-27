import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { DottedWorld } from "@/components/charts/DottedWorld.tsx";
import { StatusGlobe } from "@/components/charts/StatusGlobe.tsx";
import { useMap, usePreferences } from "@/hooks/queries.ts";
import { binPoints, CELL_DEGREES, type MapCell } from "@/lib/mapCells.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The Overview's geographic card: where the monitored fleet physically is, and
 * what state it is in there.
 *
 * A dot is one located provider component, never a company's head office —
 * placing a provider at its registered address would put most of the fleet in
 * one pile over San Francisco and say nothing about where a fault is.
 *
 * The count of components it could not place is shown in every populated
 * state, not only when the map is empty. A map that stays quiet about its own
 * gaps misrepresents its coverage, and this one has real gaps by construction:
 * a provider that lists only functional components has no geography to show.
 */
export function GeoCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const view = usePreferences().data?.mapView ?? "off";
  const { data, isError } = useMap(view !== "off");

  const cells: MapCell[] = useMemo(
    () => binPoints(data?.points ?? [], CELL_DEGREES),
    [data?.points],
  );

  if (view === "off") return null;

  const unplaced = (data?.unlocated ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const located = data?.points.length ?? 0;

  const onSelect = (): void => {
    // The providers list, with no fragment. Routing here is hash-based
    // (src/ui/routePaths.ts), so `/providers#cloudflare` would put a fragment
    // inside a fragment — and no provider row implements an anchor to land on
    // anyway. Deep-linking to one row is a separate change.
    navigate(ROUTE_PATHS.providers);
  };

  return (
    <Card className="anim-fade flex flex-col gap-3 p-4" style={{ animationDelay: "260ms" }}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          {t("map.title")}
        </h3>
      </div>

      {isError ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t("map.error")}
        </p>
      ) : located === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("map.empty", { count: unplaced })}
        </p>
      ) : (
        <TooltipProvider>
          {/* 472px, settled by looking at it: at 320 the map is 186px tall,
              the land grid's pitch drops to 2.7px, the coastline dissolves and
              the outage cell stops being findable. The card is tall as a
              result — accepted, because the whole surface is off by default,
              so an operator who turns it on has chosen to spend the space. */}
          <div className="h-[472px]">
            {view === "globe" ? (
              <StatusGlobe cells={cells} onSelect={onSelect} />
            ) : (
              <DottedWorld cells={cells} onSelect={onSelect} />
            )}
          </div>
        </TooltipProvider>
      )}

      {located > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("map.footnote", { located, unplaced })}
        </p>
      )}
    </Card>
  );
}
