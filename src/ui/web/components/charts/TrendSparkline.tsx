import { Area, AreaChart, ReferenceLine, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { statusFill, TREND_CHART, uptimeDomain } from "@/lib/chartConfig.ts";
import type { DayUptime } from "@/lib/types.ts";

/**
 * A provider's daily uptime at row height: shape only, no axes, no tooltip.
 *
 * No tooltip on purpose — the whole row is a button, and a hover card inside a
 * button competes with the click it invites. The exact numbers are one click
 * away in the drawer.
 *
 * A solid stroke rather than the header chart's gradient: 28px is too short for
 * two stops to read as anything but a muddy band.
 */
export function TrendSparkline({ series }: { series: DayUptime[] }) {
  const domain = uptimeDomain(series.map((entry) => entry.uptime));

  return (
    <ChartContainer config={{}} className="h-7 w-full">
      <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis domain={domain} hide />
        {/* A faint full-width track behind the line, in the `unknown` colour —
            the same "not measured" grey the daily bars use. With
            `connectNulls={false}`, a provider whose record starts a third of
            the way into the window draws a line that starts a third of the way
            across, and with nothing behind it the row reads as broken or
            misaligned rather than as short of history. The track is what says
            "this is the whole window, and this part of it is unmeasured". */}
        <ReferenceLine
          y={domain[0]}
          stroke={statusFill("unknown")}
          strokeWidth={1}
          opacity={0.7}
        />
        <Area
          type="monotone"
          dataKey="uptime"
          stroke={TREND_CHART.stroke}
          strokeWidth={1.5}
          fill={TREND_CHART.stroke}
          fillOpacity={0.12}
          connectNulls={false}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
