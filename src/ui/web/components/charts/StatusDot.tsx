import { statusFill } from "@/lib/chartConfig.ts";
import { cn } from "@/lib/utils.ts";

/**
 * Not a chart — a dot. No Recharts, no ChartContainer.
 *
 * @param glow halo radius in px — 12 on the overview, 8 in the providers table,
 *   none in the lists. The halo is the status colour at 55%, as the prototype
 *   draws it, not the solid colour.
 * @param pulse the slow ring of a state that is still unfolding.
 */
export function StatusDot({
  status, size = 8, glow = 0, pulse = false,
}: { status: string; size?: number; glow?: number; pulse?: boolean }) {
  const fill = statusFill(status);
  return (
    <span
      className={cn("dot inline-block rounded-full", pulse && "dot-pulse")}
      style={{
        width: size,
        height: size,
        background: fill,
        ...(glow > 0
          ? { boxShadow: `0 0 ${glow}px color-mix(in srgb, ${fill} 55%, transparent)` }
          : {}),
        // The pulse expands in currentColor, so the dot carries its colour twice.
        ...(pulse ? { color: fill } : {}),
      }}
    />
  );
}
