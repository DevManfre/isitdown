import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.tsx";
import { compareColor, uptimeDomain } from "@/lib/chartConfig.ts";
import { formatDay, formatPercent, formatPercentShort } from "@/lib/format.ts";
import type { ComparedDay } from "@/lib/history.ts";

/**
 * Up to five providers' daily uptime on one pair of axes — roadmap 5.7 and 4.13.
 *
 * Lines rather than the header chart's filled area: translucent fills over each
 * other produce colours that belong to no provider, and the question here is
 * which line is higher, not how much area is under it.
 *
 * `connectNulls` stays off for the same reason it is off on the trend chart —
 * an unmeasured day is a hole in the record, and a provider added last week has
 * a lot of them next to one watched all quarter.
 */
export function UptimeCompareChart({
  rows,
  labels,
  label,
}: {
  rows: ComparedDay[];
  labels: string[];
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const domain = uptimeDomain(rows.flatMap((row) => row.values));

  return (
    <ChartContainer
      config={Object.fromEntries(
        labels.map((name, index) => [`s${index}`, { label: name, color: compareColor(index) }]),
      )}
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
        {labels.map((name, index) => (
          <Line
            key={name}
            type="monotone"
            dataKey={(row: ComparedDay) => row.values[index]}
            name={name}
            stroke={compareColor(index)}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
