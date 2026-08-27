import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { drawOrder, statusLabelKey, statusTier, tierFill } from "@/lib/chartConfig.ts";
import { projectEquirect } from "@/lib/mapProjection.ts";
import { markerRadius, type MapCell } from "@/lib/mapCells.ts";
import grid from "@/lib/mapGrid.generated.json" with { type: "json" };

/**
 * The dotted world map: a base grid of land dots with one status marker per
 * populated cell.
 *
 * Base dots and markers are placed by the same `projectEquirect`, so they
 * cannot drift apart. Markers are real `<circle>` elements rather than pins
 * baked into an SVG string — a string cannot carry a tooltip, a click target,
 * or a focus ring, and all three are what make the map usable rather than
 * decorative.
 */
export function DottedWorld({
  cells,
  onSelect,
}: {
  cells: MapCell[];
  onSelect: (cell: MapCell) => void;
}) {
  const { t } = useTranslation();
  const { width, height, points } = grid;

  // Worst-last, via the shared `drawOrder` (chartConfig.ts) so this map and
  // the globe can never disagree on which fault wins. At 4° the European
  // cells overlap enough for draw order to decide what an operator actually
  // sees — the prototype in `design/` showed Frankfurt disappearing under
  // Amsterdam without this. Sorting a copy, never `cells` itself — it is the
  // caller's array.
  const ordered = useMemo(
    () => [...cells].sort((a, b) => drawOrder(statusTier(a.worst)) - drawOrder(statusTier(b.worst))),
    [cells],
  );

  // The base grid never changes, and it is a few thousand nodes: rebuilding it
  // on every status refetch is the one avoidable cost in this view.
  const base = useMemo(
    () =>
      points.map((point, index) => {
        const { x, y } = projectEquirect(point.lat, point.lon, width, height);
        return <circle key={index} cx={x} cy={y} r={1.1} className="fill-border" />;
      }),
    [points, width, height],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      role="img"
      aria-label={t("map.aria.world")}
    >
      <g data-testid="dotted-world-base">{base}</g>
      <g data-testid="dotted-world-markers">
        {ordered.map((cell) => {
          const { x, y } = projectEquirect(cell.lat, cell.lon, width, height);
          const radius = markerRadius(cell.count);
          const tier = statusTier(cell.worst);
          const label = t("map.cell.aria", {
            count: cell.count,
            locations: cell.points.map((point) => point.name).join(", "),
            status: t(statusLabelKey(cell.worst)),
          });

          return (
            <Tooltip key={`${cell.lat},${cell.lon}`}>
              <TooltipTrigger asChild>
                <g>
                  {/* A ring on a fault cell, so it survives being one dot among
                      270 on a dense map. Operational cells get none — a ring on
                      everything is a ring on nothing. */}
                  {(tier === "warn" || tier === "danger") && (
                    <circle
                      cx={x}
                      cy={y}
                      r={radius + 3}
                      fill="none"
                      stroke={tierFill(tier)}
                      strokeWidth={1.2}
                      opacity={0.55}
                      pointerEvents="none"
                    />
                  )}
                  <circle
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    cx={x}
                    cy={y}
                    r={radius}
                    fill={tierFill(tier)}
                    className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelect(cell)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(cell);
                      }
                    }}
                  />
                </g>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{t(statusLabelKey(cell.worst))}</p>
                <p className="text-xs text-muted-foreground">
                  {cell.points
                    .slice(0, 6)
                    .map((point) => point.name)
                    .join(", ")}
                  {cell.points.length > 6 ? t("map.cell.more", { count: cell.points.length - 6 }) : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </g>
    </svg>
  );
}
