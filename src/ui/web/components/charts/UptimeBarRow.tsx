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
          // Recharts tweens the tooltip wrapper's own transform over 400ms, so
          // the card crawls after the cursor from wherever it last stood —
          // across 90 bars it never catches up, which is the drift that reads
          // as a broken hover. The SVG cursor rect moves instantly; only the
          // card lagged, so the two appeared to belong to different bars.
          isAnimationActive={false}
          // Without an escape hatch the card is clamped inside a viewBox only
          // as tall as the row itself (22px compact, 44px full), which pins it
          // over the very bars it describes. Let it leave vertically and open
          // upwards, so it sits clear of the row instead of on top of it.
          allowEscapeViewBox={{ x: false, y: true }}
          reverseDirection={{ x: false, y: true }}
          // The default cursor is a solid `fill-muted` rect the full height of
          // the chart: beside a 4px operational bar it reads as a stray block,
          // not as "this column". Same band, a third of the weight.
          cursor={{ fillOpacity: 0.35, radius: 2 }}
          content={
            <ChartTooltipContent
              className="gap-0"
              labelFormatter={(_label, payload) =>
                `${formatDay(i18n.language, String(payload?.[0]?.payload?.day))} · ${t(
                  statusLabelKey(String(payload?.[0]?.payload?.status)),
                )}`
              }
              // `value` is a severity weight on the 0–100 bar scale, not a
              // measurement: printing it claimed "18.92" about a day whose
              // status is merely unknown, labelled with an untranslated
              // "value". The day and its status are the whole payload.
              formatter={() => null}
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
