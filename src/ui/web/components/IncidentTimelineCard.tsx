import { useState } from "react";
import { useTranslation } from "react-i18next";
import { generatePath, Link } from "react-router";
import { cn } from "@/lib/utils.ts";
import { WidgetCard } from "@/widgets/catalog/WidgetCard.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { OperatorMetricLane } from "@/components/OperatorMetricLane.tsx";
import { useAnnotations, useIncidentTimeline, useOperatorSeries } from "@/hooks/queries.ts";
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
  // Roadmap 6.11: the operator's own metric, one at a time — two y-axes on one
  // lane is a chart nobody reads. The first declared series is shown until
  // another, or none, is picked.
  const { data: seriesList } = useOperatorSeries();
  const [pickedSeries, setPickedSeries] = useState<string | undefined>(undefined);
  const allSeries = seriesList?.series ?? [];
  const seriesChoice = pickedSeries ?? (allSeries[0] === undefined ? "none" : String(allSeries[0].id));
  const metric = allSeries.find((entry) => String(entry.id) === seriesChoice);

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
  const windows = (timeline?.incidents ?? []).map((incident) => ({
    startMs: Math.max(Date.parse(incident.startedAt), fromMs),
    endMs: incident.resolvedAt === null ? toMs : Math.min(Date.parse(incident.resolvedAt), toMs),
    providerId: incident.providerId,
    name: incident.name,
  }));

  return (
    // Secondary to the view's one question — what broke, and is it over — so
    // it folds (dashboard-design-direction), counting what it holds while shut.
    <WidgetCard
      role="region"
      aria-label={t("timeline.title")}
      title={t("timeline.title")}
      disclosure={{
        id: "incidents-timeline",
        summary: timeline === undefined ? undefined : t("incidents.total", { count: timeline.incidents.length }),
      }}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        {allSeries.length > 0 && (
          <Select value={seriesChoice} onValueChange={setPickedSeries}>
            <SelectTrigger className="w-56" aria-label={t("series.picker")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("series.picker.none")}</SelectItem>
              {allSeries.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
      ) : lanes.length === 0 && metric === undefined ? (
        <p className="py-6 text-sm text-muted-foreground">{t("timeline.empty", { days })}</p>
      ) : (
        <>
          {lanes.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("timeline.empty", { days })}</p>}
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
                <div className="relative h-10 border-t [container-type:inline-size]">
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
                        // Roadmap 4.20 (WCAG 2.2 target size): the link is at least
                        // 24px each way and centred on the bar, while the bar drawn
                        // inside keeps its true width — a minute-long incident is a
                        // sliver on a 30-day axis, and it is still something to click.
                        // On a dense axis neighbours still overlap, which axe's
                        // target-size reports on real data: that is inherent to a
                        // Gantt, and WCAG 2.5.8 allows it where the same function
                        // is on the page in a compliant control — every incident
                        // here is also a full-size row in the list below.
                        className="absolute top-1.5 h-7 min-w-6 -translate-x-1/2 rounded-sm outline-offset-2 focus-visible:outline-2"
                        style={{
                          left: `calc(${bar.left}% + ${bar.width}% / 2)`,
                          width: `${bar.width}%`,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1 left-1/2 -translate-x-1/2 rounded-sm"
                          // `cqw` is a share of the lane (its container), which is
                          // what `bar.width` is a percentage of.
                          style={{ width: `calc(${bar.width} * 1cqw)`, backgroundColor: impactColor(bar.incident.impact) }}
                        />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            {metric !== undefined && (
              <OperatorMetricLane series={metric} fromMs={fromMs} toMs={toMs} windows={windows} nameOf={nameOf} />
            )}
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
    </WidgetCard>
  );
}
