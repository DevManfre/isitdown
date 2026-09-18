import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart.tsx";
import {
  annotationColour,
  TREND_CHART,
  uptimeDomain,
} from "@/lib/chartConfig.ts";
import { formatDay, formatPercent, formatPercentShort } from "@/lib/format.ts";
import type { Annotation, DayUptime } from "@/lib/types.ts";

/**
 * Daily uptime over the active window: the view's answer to "which way is
 * this going", which no single percentage can give.
 *
 * `connectNulls` stays off deliberately. An unmeasured day is a hole in the
 * record, and bridging it would draw a straight line through days nobody
 * observed — the chart equivalent of reporting 100% for a dashboard that was
 * switched off.
 *
 * Recharts' own animation is off for the same reason `UptimeBarRow` turns it
 * off: motion.css owns view entry, and two animation systems on one node is
 * the double-play bug the React port exists to end.
 */
export function UptimeTrendChart({
  series,
  label,
  annotations = [],
}: {
  series: DayUptime[];
  label: string;
  /**
   * The operator's own markers — roadmap 12.1. Drawn on the day they fall on,
   * because the series is one point per day: a marker at 14:05 belongs on that
   * day's point, and pretending to place it between two points would claim a
   * resolution this chart does not have.
   */
  annotations?: Annotation[];
}) {
  const { t, i18n } = useTranslation();
  const gradientId = useId();
  const domain = uptimeDomain(series.map((entry) => entry.uptime));
  // Only the ones inside the window: a marker with no matching day would be
  // placed by Recharts at the chart's edge, where it would read as an event on
  // the first day rather than as one outside the view.
  const days = new Set(series.map((entry) => entry.day));
  const marks = annotations.filter((annotation) =>
    days.has(annotation.at.slice(0, 10)),
  );

  return (
    <ChartContainer
      config={{
        uptime: { label: t("history.trend-title"), color: TREND_CHART.stroke },
      }}
      className="anim-bar h-44 w-full"
      aria-label={label}
    >
      <AreaChart
        data={series}
        margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={TREND_CHART.areaFrom}
              stopOpacity={0.55}
            />
            <stop
              offset="100%"
              stopColor={TREND_CHART.areaTo}
              stopOpacity={0.05}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          // 90 day labels do not fit; Recharts drops ticks itself given a gap.
          minTickGap={64}
          tickFormatter={(day: string) => formatDay(i18n.language, day)}
        />
        <YAxis
          domain={domain}
          width={48}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) =>
            formatPercentShort(i18n.language, value)
          }
        />
        <ChartTooltip
          isAnimationActive={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                formatDay(i18n.language, String(payload?.[0]?.payload?.day))
              }
              formatter={(value) =>
                value === null
                  ? t("history.month-no-data")
                  : formatPercent(i18n.language, Number(value))
              }
            />
          }
        />
        {marks.map((annotation) => (
          <ReferenceLine
            key={annotation.id}
            x={annotation.at.slice(0, 10)}
            stroke={annotationColour(annotation.colour)}
            strokeDasharray="3 3"
            strokeWidth={1.5}
            label={{
              value: annotation.label,
              position: "insideTopLeft",
              fill: annotationColour(annotation.colour),
              fontSize: 10,
            }}
          />
        ))}
        <Area
          type="monotone"
          dataKey="uptime"
          stroke={TREND_CHART.stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          connectNulls={false}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
