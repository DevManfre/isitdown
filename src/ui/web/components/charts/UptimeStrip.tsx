import { Bar, BarChart, Cell, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { chartConfigFor, statusFill, statusMuted } from "@/lib/chartConfig.ts";
import type { HistoryBucket } from "@/lib/types.ts";

/** The compact inline variant used inside the providers table. */
export function UptimeStrip({ buckets }: { buckets: HistoryBucket[] }) {
  const data = buckets.map((bucket) => ({ day: bucket.day, status: bucket.status, value: 100 }));
  return (
    <ChartContainer config={chartConfigFor()} className="anim-bar anim-bar-strip h-3 w-full">
      <BarChart data={data} barCategoryGap={1} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <YAxis domain={[0, 100]} hide />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.day} fill={statusFill(entry.status)} opacity={statusMuted(entry.status) ? 0.45 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
