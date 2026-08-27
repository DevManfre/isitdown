import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import { Trans, useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { AGGREGATE_FILL, chartConfigFor, statusFill } from "@/lib/chartConfig.ts";

/**
 * What the ring grid becomes once there are too many providers to draw one
 * ring each: the fleet's average 90-day uptime, and how the fleet splits.
 *
 * Nothing in here is per-provider, which is the point — this is the block that
 * stops the hero growing with the fleet, so it must read the same at fifteen
 * providers and at two hundred.
 *
 * The ring floors a measured average at 2% for the same reason `UptimeRing`
 * does: a ring that reads as empty says less than one that reads as barely
 * started. A never-measured fleet (0) draws the unbroken grey ring.
 */
export function FleetSummary({
  average, operational, alarm,
}: {
  average: number;
  operational: number;
  alarm: number;
}) {
  const { t, i18n } = useTranslation();
  const value = average > 0 ? Math.max(2, average) : 0;

  return (
    <div
      data-slot="fleet-summary"
      className="fleet-summary flex items-center gap-4 rounded-lg border border-border bg-card/70 px-5 py-4"
    >
      <div className="relative size-18">
        <ChartContainer config={chartConfigFor()} className="anim-ring size-18">
          <RadialBarChart
            data={[{ name: "aggregate", value }]}
            // Recharts insets a polar chart by 5px a side by default, so the
            // drawn ring was smaller than its box while the favicon disc kept
            // filling 75% of the box — which left a 2px band at 56px and only 5
            // of the intended 9.6px at 80. Zero margin makes the ring the size
            // innerRadius/outerRadius already claim.
            margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
            innerRadius="76%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              cornerRadius={4}
              isAnimationActive={false}
              fill={AGGREGATE_FILL}
              background={{ fill: statusFill("unknown") }}
            />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[11.5px] text-primary">
            <NumberTicker locale={i18n.language} value={average} decimalPlaces={2} suffix="%" />
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10.5px] tracking-widest text-muted-foreground uppercase">
          {t("overview.summary.window")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="border-status-operational/35 bg-status-operational/10 font-mono text-status-operational"
          >
            <Trans
                i18nKey="overview.summary.operational"
                count={operational}
                values={{ count: operational }}
                components={[<NumberTicker locale={i18n.language} value={operational} />]}
              />
          </Badge>
          {alarm > 0 && (
            <Badge
              variant="outline"
              className="border-destructive/40 bg-destructive/12 font-mono text-destructive"
            >
              <Trans
                i18nKey="overview.summary.alarm"
                count={alarm}
                values={{ count: alarm }}
                components={[<NumberTicker locale={i18n.language} value={alarm} />]}
              />
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
