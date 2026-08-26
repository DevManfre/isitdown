import { useState } from "react";
import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { chartConfigFor, statusColor, statusFill } from "@/lib/chartConfig.ts";
import { faviconCandidates } from "@/lib/favicon.ts";
import type { ProviderStatus } from "@/lib/types.ts";

/**
 * A provider tile: a ring in its status colour around its short code.
 *
 * The ring gauges the whole 0–100% scale. This is a deliberate departure from
 * the design prototype, which zoomed on the last percent: that only worked
 * while live polling kept every uptime between 99 and 100, and backfilled
 * history makes far lower values normal and would collapse every ring to a
 * stub. Keep the departure, and keep its floor — a measured but tiny uptime
 * still draws a visible sliver (6° in the vanilla version, 2% here), because a
 * ring that reads as empty says less than one that reads as barely started.
 * Zero — never measured, or fully down — renders as an unbroken grey ring.
 */
export function UptimeRing({ provider, delay }: { provider: ProviderStatus; delay?: string }) {
  const candidates = faviconCandidates(provider.baseUrl);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const icon = candidates[attempt];

  const value = provider.uptime90 > 0 ? Math.max(2, provider.uptime90) : 0;

  return (
    <div
      className="ring-tile anim-rise flex flex-col items-center gap-2 rounded-lg border border-border p-4"
      style={delay === undefined ? undefined : { animationDelay: delay }}
    >
      <div className="relative size-20">
        <ChartContainer config={chartConfigFor()} className="anim-ring size-20">
          <RadialBarChart
            data={[{ name: provider.id, value }]}
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
              fill={statusFill(provider.overallStatus)}
              background={{ fill: statusFill("unknown") }}
            />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {icon !== undefined && (
            // The favicon sits on its own white disc filling the ring's core:
            // a dark mark (GitHub's octocat) is invisible against the
            // dashboard's own dark surface otherwise. The three-letter
            // fallback below needs no disc — it is painted in the status
            // colour, which reads on either surface.
            <img
              role="presentation"
              alt=""
              src={icon}
              className={
                loaded
                  ? "size-15 rounded-full bg-[var(--ring-icon-bg)] object-contain p-2.5"
                  : "hidden"
              }
              onLoad={() => setLoaded(true)}
              onError={() => setAttempt((n) => n + 1)}
            />
          )}
          {!loaded && (
            <span className="font-mono text-sm" style={{ color: statusColor(provider.overallStatus) }}>
              {provider.name.slice(0, 3).toUpperCase()}
            </span>
          )}
        </div>
      </div>
      <span className="text-sm">{provider.name}</span>
    </div>
  );
}
