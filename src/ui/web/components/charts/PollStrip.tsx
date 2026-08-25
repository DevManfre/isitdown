import { Bar, BarChart, Cell, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { chartConfigFor, severity, statusFill, statusMuted } from "@/lib/chartConfig.ts";
import { trimToLatest } from "@/lib/favicon.ts";
import type { SampleRow } from "@/lib/types.ts";

/** The incident view's strip of the most recent polls, oldest on the left. */
export function PollStrip({ samples, size = 24 }: { samples: SampleRow[]; size?: number }) {
  const data = trimToLatest(samples, size)
    .slice()
    .reverse()
    .map((sample) => ({
      at: sample.observedAt,
      status: sample.overallStatus,
      value: severity(sample.overallStatus, "poll"),
    }));

  return (
    <ChartContainer config={chartConfigFor("poll")} className="anim-bar h-8 w-full">
      <BarChart data={data} barCategoryGap={2} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <YAxis domain={[0, 100]} hide />
        <Bar dataKey="value" isAnimationActive={false} radius={1}>
          {data.map((entry) => (
            <Cell key={entry.at} fill={statusFill(entry.status)} opacity={statusMuted(entry.status) ? 0.45 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
