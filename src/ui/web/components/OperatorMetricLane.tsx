import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useSeriesReading } from "@/hooks/queries.ts";
import { OPERATOR_SERIES } from "@/lib/chartConfig.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import { metricConclusion, metricLine, type Window } from "@/lib/operatorMetric.ts";
import type { OperatorSeries } from "@/lib/types.ts";

/**
 * The operator's own metric as one more lane under the incident Gantt —
 * roadmap 6.11, as agreed in design/claude-design-prototypes/operator-metric.
 *
 * Each incident's window is carried down into the lane as a faint band, so the
 * eye follows a bar into the metric without a crosshair. The sentence under it
 * states the answer for anyone who cannot see the line: where the series
 * peaked, and whether a provider incident was running then — or plainly that
 * none was.
 *
 * Its own query and its own states: Prometheus failing says so in this lane,
 * with a retry, and leaves the Gantt above untouched.
 */
export function OperatorMetricLane({
  series,
  fromMs,
  toMs,
  windows,
  nameOf,
}: {
  series: OperatorSeries;
  fromMs: number;
  toMs: number;
  windows: Window[];
  nameOf: (providerId: string) => string;
}) {
  const { t, i18n } = useTranslation();
  // Rounded to the minute, so the query key holds still between renders.
  const minute = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
  const { data, isPending, isError, error, refetch, isFetching } = useSeriesReading(series.id, minute(fromMs), minute(toMs));

  const percentAt = (ms: number) => ((ms - fromMs) / (toMs - fromMs)) * 100;
  const value = (number: number) => `${formatNumber(i18n.language, Math.round(number * 100) / 100)}${series.unit === "" ? "" : ` ${series.unit}`}`;

  const points = data?.points ?? [];
  const line = metricLine(points, fromMs, toMs);
  const conclusion = metricConclusion(points, windows);
  const source = series.source === "prometheus" ? t("series.source.prometheus") : t("series.source.csv");

  return (
    <>
      <div className="flex flex-col gap-0.5 border-t-2 py-2.5 pr-2">
        <span className="truncate text-sm">{series.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {series.unit === "" ? source : `${series.unit} · ${source}`}
        </span>
      </div>
      <div className="relative h-32 border-t-2" role="img" aria-label={t("series.lane", { name: series.name })}>
        {windows.map((window) => (
          <span
            key={`${window.providerId}-${window.startMs}`}
            aria-hidden="true"
            className="absolute inset-y-0 bg-destructive/10"
            style={{ left: `${percentAt(window.startMs)}%`, width: `${Math.max(percentAt(window.endMs) - percentAt(window.startMs), 0.3)}%` }}
          />
        ))}
        {isPending ? (
          <Skeleton className="absolute inset-x-0 inset-y-3" />
        ) : isError ? (
          <div role="alert" className="absolute inset-0 flex items-center gap-3 px-3">
            <span className="text-sm text-destructive">
              {t("series.failed", { error: error instanceof Error ? error.message : String(error) })}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={isFetching} onClick={() => void refetch()}>
              {t("action.retry")}
            </Button>
          </div>
        ) : points.length === 0 ? (
          <p className="absolute inset-0 flex items-center px-3 text-sm text-muted-foreground">{t("series.empty")}</p>
        ) : (
          <>
            <span aria-hidden="true" className="absolute left-1 top-1 text-xs text-muted-foreground">
              {value(line.max)}
            </span>
            <span aria-hidden="true" className="absolute bottom-1 left-1 text-xs text-muted-foreground">
              {value(line.min)}
            </span>
            <svg
              aria-hidden="true"
              className="absolute inset-x-0 top-5 bottom-5 h-[calc(100%-2.5rem)] w-full overflow-visible"
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
            >
              <polyline
                fill="none"
                stroke={OPERATOR_SERIES}
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                points={line.points}
              />
            </svg>
          </>
        )}
      </div>
      {conclusion !== null && (
        <p className="col-span-2 pt-2 text-xs text-muted-foreground">
          {conclusion.during === null
            ? t("series.peak.alone", {
                name: series.name,
                value: value(conclusion.peak.value),
                when: formatDateTime(i18n.language, conclusion.peak.at),
              })
            : t("series.peak.during", {
                name: series.name,
                value: value(conclusion.peak.value),
                when: formatDateTime(i18n.language, conclusion.peak.at),
                provider: nameOf(conclusion.during.providerId),
                incident: conclusion.during.name,
              })}
        </p>
      )}
    </>
  );
}
