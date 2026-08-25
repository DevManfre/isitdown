import { Bar, BarChart, Cell, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { chartConfigFor, statusFill } from "@/lib/chartConfig.ts";
import { formatPercent } from "@/lib/format.ts";

/**
 * Four calendar months of aggregate uptime. A month with no samples is drawn at
 * a floor and faded: 0% would read as an outage that never happened.
 */
export function MonthColumns({
  months, labelFor, noDataLabel,
}: {
  months: { month: string; uptime: number | null }[];
  labelFor: (month: string) => string;
  noDataLabel: string;
}) {
  const { i18n } = useTranslation();
  const data = months.map((month) => ({
    month: month.month,
    measured: month.uptime !== null,
    value: month.uptime === null ? 8 : Math.max(Math.round(month.uptime * 0.6), 8),
  }));

  return (
    <div className="month-cols flex items-end gap-6">
      {months.map((month, index) => (
        <div key={month.month} className="month-col flex flex-1 flex-col items-center gap-1">
          <span className="anim-fade font-mono text-xs text-muted-foreground">
            {month.uptime === null ? noDataLabel : formatPercent(i18n.language, month.uptime)}
          </span>
          <ChartContainer
            config={chartConfigFor()}
            className="anim-bar anim-bar-month month-bar h-16 w-full"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <BarChart data={[data[index]]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <YAxis domain={[0, 100]} hide />
              <Bar dataKey="value" isAnimationActive={false} radius={2}>
                <Cell
                  fill={statusFill("operational")}
                  opacity={data[index]?.measured === true ? 1 : 0.35}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
          <span className="font-mono text-xs text-muted-foreground">{labelFor(month.month)}</span>
        </div>
      ))}
    </div>
  );
}
