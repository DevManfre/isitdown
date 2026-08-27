import { useState } from "react";
import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart.tsx";
import { chartConfigFor, statusColor, statusFill } from "@/lib/chartConfig.ts";
import { faviconCandidates } from "@/lib/favicon.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

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
export function UptimeRing({
  provider, delay, size = 80,
}: { provider: ProviderStatus; delay?: string; size?: number }) {
  const candidates = faviconCandidates(provider.baseUrl);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const icon = candidates[attempt];

  const value = provider.uptime90 > 0 ? Math.max(2, provider.uptime90) : 0;

  // The whole tile is proportional to its ring, so one `size` carries the
  // 80px hero grid and the 56px band without a second set of numbers: the
  // favicon disc fills the ring's core at 75% and insets by an eighth, the
  // ratios the 80px original already used (`size-15`, `p-2.5`).
  const disc = Math.round(size * 0.75);
  const inset = Math.round(size * 0.125);
  const large = size >= 80;

  return (
    <div
      // The semantic hook a caller (and a test) reads, rather than the
      // `ring-tile` styling class a restyle could rename — the same idiom as
      // StatusDot's `data-status` and the shadcn primitives' `data-slot`.
      data-slot="uptime-ring"
      className={cn(
        "ring-tile anim-rise flex flex-col items-center border border-border",
        // A fixed 112px at the hero size (80px ring + p-4 both sides), so a
        // long provider name truncates instead of stretching one tile wider
        // than its neighbours in a wrapping row. In the band the width comes
        // from the grid track instead.
        large ? "w-28 gap-2 rounded-lg p-4" : "gap-1.5 rounded-md p-3",
      )}
      style={delay === undefined ? undefined : { animationDelay: delay }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <ChartContainer
          config={chartConfigFor()}
          className="anim-ring"
          style={{ width: size, height: size }}
        >
          <RadialBarChart
            data={[{ name: provider.id, value }]}
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
                loaded ? "rounded-full bg-[var(--ring-icon-bg)] object-contain" : "hidden"
              }
              style={{ width: disc, height: disc, padding: inset }}
              onLoad={() => setLoaded(true)}
              onError={() => setAttempt((n) => n + 1)}
            />
          )}
          {!loaded && (
            <span
              className={cn("font-mono", large ? "text-sm" : "text-[11px]")}
              style={{ color: statusColor(provider.overallStatus) }}
            >
              {provider.name.slice(0, 3).toUpperCase()}
            </span>
          )}
        </div>
      </div>
      <span className={cn("max-w-full truncate", large ? "text-sm" : "text-xs")}>
        {provider.name}
      </span>
    </div>
  );
}
