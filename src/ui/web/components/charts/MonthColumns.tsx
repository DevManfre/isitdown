import { useId } from "react";
import { Bar, BarChart, Cell, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { chartConfigFor } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";

/**
 * Four calendar months of aggregate uptime. A month with no samples is drawn at
 * a floor and faded: 0% would read as an outage that never happened.
 *
 * The bar itself is drawn in the accent gradient — accent-400 into accent-700,
 * a pair that runs saturated→pale on light and pale→deep on dark, where the
 * prototype's 500→800 faded into the card's own fill at the bar's base once
 * light-mode cards went white —
 * never a status colour: a month's *height* already carries how much of it was
 * uptime, and painting every bar operational-green on top of that would read
 * as "all good" regardless of what the number actually says. The gradient
 * itself needs an SVG `<linearGradient>` def — a Recharts `Cell` only accepts
 * one solid `fill`, not a CSS `background` value.
 */
export function MonthColumns({
  months, labelFor, noDataLabel,
}: {
  months: { month: string; uptime: number | null }[];
  labelFor: (month: string) => string;
  noDataLabel: string;
}) {
  const { i18n } = useTranslation();
  const gradientId = useId();
  const data = months.map((month) => ({
    month: month.month,
    measured: month.uptime !== null,
    value: month.uptime === null ? 8 : Math.max(Math.round(month.uptime * 0.6), 8),
  }));

  return (
    <div className="month-cols flex items-end gap-6">
      <svg width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-400)" />
            <stop offset="100%" stopColor="var(--color-accent-700)" />
          </linearGradient>
        </defs>
      </svg>
      {months.map((month, index) => (
        <div key={month.month} className="month-col flex flex-1 flex-col items-center gap-1">
          <span className="anim-fade font-mono text-xs text-muted-foreground">
            {month.uptime === null ? (
              noDataLabel
            ) : (
              <NumberTicker locale={i18n.language} value={month.uptime} decimalPlaces={2} suffix="%" />
            )}
          </span>
          <ChartContainer
            config={chartConfigFor()}
            className="anim-bar anim-bar-month month-bar h-16 w-full"
            style={{ animationDelay: stagger(index, { base: 90, step: 38, cap: 380 }) }}
          >
            <BarChart data={[data[index]]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <YAxis domain={[0, 100]} hide />
              <Bar dataKey="value" isAnimationActive={false} radius={2}>
                <Cell
                  fill={`url(#${gradientId})`}
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
