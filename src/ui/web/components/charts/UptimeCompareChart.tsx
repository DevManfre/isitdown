import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.tsx";
import { COMPARE_CHART, uptimeDomain } from "@/lib/chartConfig.ts";
import { formatDay, formatPercent, formatPercentShort } from "@/lib/format.ts";
import type { ComparedDay } from "@/lib/history.ts";

/**
 * Two providers' daily uptime on one pair of axes — roadmap 5.7.
 *
 * Lines rather than the header chart's filled area: two translucent fills over
 * each other produce a third colour that belongs to neither provider, and the
 * question here is which line is higher, not how much area is under it.
 *
 * `connectNulls` stays off for the same reason it is off on the trend chart —
 * an unmeasured day is a hole in the record, and a provider added last week has
 * a lot of them next to one watched all quarter.
 */
export function UptimeCompareChart({
  rows,
  leftLabel,
  rightLabel,
  label,
}: {
  rows: ComparedDay[];
  leftLabel: string;
  rightLabel: string;
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const domain = uptimeDomain(rows.flatMap((row) => [row.left, row.right]));

  return (
    <ChartContainer
      config={{
        left: { label: leftLabel, color: COMPARE_CHART.left },
        right: { label: rightLabel, color: COMPARE_CHART.right },
      }}
      className="anim-bar h-44 w-full"
      aria-label={label}
    >
      <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          minTickGap={64}
          tickFormatter={(day: string) => formatDay(i18n.language, day)}
        />
        <YAxis
          domain={domain}
          width={48}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatPercentShort(i18n.language, value)}
        />
        <ChartTooltip
          isAnimationActive={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                formatDay(i18n.language, String(payload?.[0]?.payload?.day))
              }
              formatter={(value) =>
                value === null ? t("history.month-no-data") : formatPercent(i18n.language, Number(value))
              }
            />
          }
        />
        <Line
          type="monotone"
          dataKey="left"
          name={leftLabel}
          stroke={COMPARE_CHART.left}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="right"
          name={rightLabel}
          stroke={COMPARE_CHART.right}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
