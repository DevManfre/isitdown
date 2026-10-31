import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart.tsx";
import { LATENCY_CHART } from "@/lib/chartConfig.ts";
import { formatDateTime, formatNumber } from "@/lib/format.ts";
import type { LatencyResponse } from "@/lib/types.ts";

/**
 * p50 and p95 of one provider's response time, with the `slowMs` threshold
 * drawn when the provider declares one — roadmap 4.14.
 *
 * Two lines rather than a band: the question is "how slow is the slow tail",
 * and a filled band between them would answer "how wide is the spread" instead.
 * The p95 is dashed so the two stay apart without the colour — the compare
 * tokens are two hues, not two promises about colour vision.
 */
export function LatencyChart({ latency, label }: { latency: LatencyResponse; label: string }) {
  const { t, i18n } = useTranslation();
  const ms = (value: number) => t("latency.ms", { value: formatNumber(i18n.language, value) });

  return (
    <ChartContainer
      config={{
        p50: { label: t("latency.p50"), color: LATENCY_CHART.p50 },
        p95: { label: t("latency.p95"), color: LATENCY_CHART.p95 },
      }}
      className="anim-bar h-44 w-full"
      // A name on a bare <div> is ignored (axe: aria-prohibited-attr) — the
      // role is what makes the conclusion in `label` reach a screen reader.
      role="img"
      aria-label={label}
    >
      <LineChart data={latency.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="at"
          tickLine={false}
          axisLine={false}
          minTickGap={64}
          tickFormatter={(at: string) => formatDateTime(i18n.language, at)}
        />
        <YAxis
          width={56}
          tickLine={false}
          axisLine={false}
          domain={[0, (max: number) => Math.max(max, latency.slowMs ?? 0)]}
          tickFormatter={(value: number) => formatNumber(i18n.language, value)}
        />
        {latency.slowMs === null ? null : (
          <ReferenceLine
            y={latency.slowMs}
            stroke={LATENCY_CHART.slow}
            strokeDasharray="6 4"
            label={{ value: t("latency.threshold", { ms: formatNumber(i18n.language, latency.slowMs) }), position: "insideTopRight", fill: LATENCY_CHART.slow, fontSize: 11 }}
          />
        )}
        <ChartTooltip
          isAnimationActive={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => formatDateTime(i18n.language, String(payload?.[0]?.payload?.at))}
              formatter={(value) => ms(Number(value))}
            />
          }
        />
        <Line type="monotone" dataKey="p50" stroke={LATENCY_CHART.p50} strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line type="monotone" dataKey="p95" stroke={LATENCY_CHART.p95} strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} dot={false} />
      </LineChart>
    </ChartContainer>
  );
}
