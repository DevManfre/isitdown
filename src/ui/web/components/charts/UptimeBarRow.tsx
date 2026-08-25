import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.tsx";
import { chartConfigFor, severity, statusFill, statusLabelKey, statusMuted, type BarScale } from "@/lib/chartConfig.ts";
import { formatDay } from "@/lib/format.ts";
import type { HistoryBucket } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

const HEIGHT: Record<BarScale, number> = { row: 44, compact: 22, poll: 26 };

/**
 * One bar per day, oldest first: the status-page uptime row.
 *
 * Recharts' own animation is off on purpose — motion.css owns entry animation
 * for the whole view, and two animation systems on one node is what produced
 * the double-play bug this port is meant to end.
 */
export function UptimeBarRow({
  buckets, scale = "row", className,
}: { buckets: HistoryBucket[]; scale?: BarScale; className?: string }) {
  const { t, i18n } = useTranslation();
  const data = buckets.map((bucket) => ({
    day: bucket.day,
    status: bucket.status,
    value: severity(bucket.status, scale),
  }));

  return (
    <ChartContainer
      config={chartConfigFor(scale)}
      // `anim-bar-strip`'s 0.45s timing belongs to UptimeStrip alone — vanilla
      // never applied it to the compact bar row, only to uptimeStrip(). Every
      // UptimeBarRow scale (row, compact, poll) keeps the base 0.5s `anim-bar`.
      className={cn("anim-bar w-full", className)}
      style={{ height: HEIGHT[scale] }}
    >
      <BarChart data={data} barCategoryGap={1} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="day" hide />
        <YAxis domain={[0, 100]} hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) =>
                `${formatDay(i18n.language, String(payload?.[0]?.payload?.day))} · ${t(
                  statusLabelKey(String(payload?.[0]?.payload?.status)),
                )}`
              }
              hideIndicator
            />
          }
        />
        <Bar dataKey="value" isAnimationActive={false} radius={1}>
          {data.map((entry) => (
            <Cell
              key={entry.day}
              fill={statusFill(entry.status)}
              opacity={statusMuted(entry.status) ? 0.45 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
