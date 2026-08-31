import { useId } from "react";
import { Bar, BarChart, Cell, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { chartConfigFor, TREND_CHART, uptimeDomain } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";

/**
 * Four calendar months of aggregate uptime. A month with no samples is drawn at
 * a floor and faded: 0% would read as an outage that never happened.
 *
 * Every bar shares one Y domain, computed by `uptimeDomain` — a fleet living
 * between 92% and 100% used to draw on a `[0, 100]` axis, where eight points
 * of real variation occupied eight percent of the box and every month looked
 * the same height. `uptimeDomain` documents the compressed-domain reasoning;
 * this component just supplies it the measured months and lets a real bar sit
 * at its own figure.
 *
 * The bar itself is drawn in the accent gradient — `TREND_CHART.areaFrom` into
 * `TREND_CHART.areaTo`, a pair that runs saturated→pale on light and
 * pale→deep on dark, where the prototype's 500→800 faded into the card's own
 * fill at the bar's base once light-mode cards went white —
 * never a status colour: a month's *height* already carries how much of it was
 * uptime, and painting every bar operational-green on top of that would read
 * as "all good" regardless of what the number actually says. The gradient
 * itself needs an SVG `<linearGradient>` def — a Recharts `Cell` only accepts
 * one solid `fill`, not a CSS `background` value.
 */
export function MonthColumns({
  months, labelFor, noDataLabel, heading,
}: {
  months: { month: string; uptime: number | null }[];
  labelFor: (month: string) => string;
  noDataLabel: string;
  heading: string;
}) {
  const { i18n } = useTranslation();
  const gradientId = useId();
  const domain = uptimeDomain(months.map((month) => month.uptime));
  const data = months.map((month) => ({
    month: month.month,
    measured: month.uptime !== null,
    // An unmeasured month keeps the prototype's faded stub: a sliver above the
    // axis, not a bar claiming a value. A measured month sits at its own
    // figure, which the domain guarantees is above the axis floor.
    uptime: month.uptime ?? domain[0] + (domain[1] - domain[0]) * 0.06,
  }));

  return (
    <div className="month-cols flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {heading}
      </span>
      {/* The baseline sits directly under the bar row, not under the month
          labels below it: it is what makes the bars read as columns standing
          on an axis rather than as blocks floating in the strip. */}
      <div className="flex items-end gap-6 border-b border-border">
        <svg width="0" height="0" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TREND_CHART.areaFrom} />
              <stop offset="100%" stopColor={TREND_CHART.areaTo} />
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
                <YAxis domain={domain} hide />
                <Bar dataKey="uptime" isAnimationActive={false} radius={2}>
                  <Cell
                    fill={`url(#${gradientId})`}
                    opacity={data[index]?.measured === true ? 1 : 0.35}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        ))}
      </div>
      <div className="flex gap-6">
        {months.map((month) => (
          <span
            key={month.month}
            className="flex-1 text-center font-mono text-xs text-muted-foreground"
          >
            {labelFor(month.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
