import { useState } from "react";
import { useTranslation } from "react-i18next";
import { generatePath, Link } from "react-router";
import { cn } from "@/lib/utils.ts";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { useAnnotations, useIncidentTimeline } from "@/hooks/queries.ts";
import { impactColor, impactKey } from "@/lib/incidents.ts";
import { formatDay, formatDuration, formatList } from "@/lib/format.ts";
import { overlaps, timelineLanes } from "@/lib/incidentTimeline.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

const RANGES = [7, 30, 90] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every incident of a window as a bar on one shared time axis, a lane per
 * provider — roadmap 4.12. What the chronological list cannot show: two
 * providers down at once, which is what a correlated outage looks like.
 *
 * The overlap band and the marker line are drawn *and* named in the text under
 * the chart: a shaded stripe is a hint, not a statement, and the conclusion
 * must survive for somebody who cannot see colour.
 */
export function IncidentTimelineCard({ providers }: { providers: { id: string; name: string }[] }) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const { data: timeline } = useIncidentTimeline(days);
  const { data: annotations } = useAnnotations({ days });

  const toMs = Date.now();
  const fromMs = toMs - days * DAY_MS;
  const nameOf = (id: string) => providers.find((provider) => provider.id === id)?.name ?? id;

  // Only providers that have something in the window get a lane: forty empty
  // rows would bury the three that matter. The order is the fleet's.
  const withIncidents = new Set(timeline?.incidents.map((incident) => incident.providerId));
  const lanes = timeline === undefined
    ? []
    : timelineLanes(timeline.incidents, providers.map((provider) => provider.id).filter((id) => withIncidents.has(id)), fromMs, toMs);
  const together = timeline === undefined ? [] : overlaps(timeline.incidents, fromMs, toMs);
  const markers = (annotations?.annotations ?? []).filter((marker) => {
    const at = Date.parse(marker.at);
    return at >= fromMs && at <= toMs;
  });
  const percentAt = (ms: number) => ((ms - fromMs) / (toMs - fromMs)) * 100;
  const day = (ms: number) => formatDay(i18n.language, new Date(ms).toISOString().slice(0, 10));
  const ticks = Array.from({ length: 7 }, (_, index) => fromMs + (index / 6) * (toMs - fromMs));

  return (
    <Card className="flex flex-col gap-3 p-4" role="region" aria-label={t("timeline.title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("timeline.title")}</span>
        <ToggleGroup
          type="single"
          value={String(days)}
          onValueChange={(next) => {
            if (next !== "") setDays(Number(next));
          }}
        >
          {RANGES.map((range) => (
            <ToggleGroupItem key={range} value={String(range)} aria-label={t("timeline.range", { days: range })}>
              {`${range}d`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {timeline === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : lanes.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t("timeline.empty", { days })}</p>
      ) : (
        <>
          <div className="grid grid-cols-[8rem_1fr] text-xs text-muted-foreground" aria-hidden="true">
            <span />
            <div className="relative h-4">
              {ticks.map((tick, index) => (
                // The first and last labels hang inward from the window's
                // edges: centred on them they would run out of the card.
                <span
                  key={tick}
                  className={cn("absolute whitespace-nowrap", index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
                  style={{ left: `${percentAt(tick)}%` }}
                >
                  {day(tick)}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[8rem_1fr]">
            {lanes.map((lane) => (
              <div key={lane.providerId} className="contents">
                <span className="truncate border-t py-2.5 pr-2 text-sm">{nameOf(lane.providerId)}</span>
                <div className="relative h-10 border-t">
                  {together.map((band) => (
                    <span
                      key={`${band.startMs}-${band.endMs}`}
                      aria-hidden="true"
                      className="absolute inset-y-0 bg-primary/15"
                      style={{ left: `${percentAt(band.startMs)}%`, width: `${percentAt(band.endMs) - percentAt(band.startMs)}%` }}
                    />
                  ))}
                  {markers.map((marker) => (
                    <span
                      key={marker.id}
                      aria-hidden="true"
                      className="absolute inset-y-0 border-l-2 border-dashed border-border"
                      style={{ left: `${percentAt(Date.parse(marker.at))}%` }}
                    />
                  ))}
                  {lane.bars.map((bar) => {
                    const minutes = Math.round(
                      ((bar.incident.resolvedAt === null ? toMs : Date.parse(bar.incident.resolvedAt)) -
                        Date.parse(bar.incident.startedAt)) / 60_000,
                    );
                    const label = t("timeline.bar", {
                      name: bar.incident.name,
                      impact: t(impactKey(bar.incident.impact)),
                      duration: formatDuration(i18n.language, Math.max(minutes, 1)),
                    });
                    return (
                      <Link
                        key={`${bar.incident.providerId}/${bar.incident.incidentId}`}
                        to={generatePath(ROUTE_PATHS.incidentDetail, {
                          providerId: bar.incident.providerId,
                          incidentId: bar.incident.incidentId,
                        })}
                        aria-label={label}
                        title={label}
                        className="absolute top-2.5 h-5 rounded-sm outline-offset-2 focus-visible:outline-2"
                        style={{
                          left: `${bar.left}%`,
                          width: `${bar.width}%`,
                          backgroundColor: impactColor(bar.incident.impact),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {together.length === 0
              ? t("timeline.no-overlap")
              : t("timeline.overlaps", {
                  count: together.length,
                  where: together
                    .slice(0, 3)
                    .map((band) => `${formatList(i18n.language, band.providerIds.map(nameOf))} (${day(band.startMs)})`)
                    .join("; "),
                })}
          </p>
        </>
      )}
    </Card>
  );
}
