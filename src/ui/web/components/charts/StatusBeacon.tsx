import { CircleCheck, CircleHelp, OctagonAlert, TriangleAlert } from "lucide-react";
import { tierColor, type StatusTier } from "@/lib/chartConfig.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The Overview hero's verdict, as one animated mark.
 *
 * Shape carries the meaning as much as colour does — a tick, a triangle, an
 * octagon — so the beacon still reads for an operator who cannot separate red
 * from green, and so a screenshot in a chat survives being greyscaled.
 *
 * The motion is graded to the news: `ok` breathes slowly because there is
 * nothing to attend to, `warn` takes the dot's existing 2.4s pulse, `danger`
 * runs it at half that. `unknown` does not move at all — nothing is unfolding,
 * we simply have not looked yet. `prefers-reduced-motion` flattens all of them,
 * which is handled once for the whole dashboard in motion.css.
 *
 * Decorative by construction: the headline it sits beside already states the
 * same verdict in words, so announcing it again would only repeat it.
 */
const MARK: Record<StatusTier, { Icon: typeof CircleCheck; motion: string }> = {
  ok: { Icon: CircleCheck, motion: "beacon-breathe" },
  warn: { Icon: TriangleAlert, motion: "beacon-pulse" },
  danger: { Icon: OctagonAlert, motion: "beacon-pulse beacon-urgent" },
  unknown: { Icon: CircleHelp, motion: "" },
};

export function StatusBeacon({ tier, size = 32 }: { tier: StatusTier; size?: number }) {
  const { Icon, motion } = MARK[tier];
  return (
    <span
      aria-hidden="true"
      data-testid="status-beacon"
      data-tier={tier}
      className={cn("status-beacon inline-flex shrink-0 items-center justify-center", motion)}
      // currentColor is what the pulse ring expands in, the same contract
      // StatusDot has with the `pulse` keyframes.
      style={{ color: tierColor(tier), width: size, height: size }}
    >
      <Icon size={size} strokeWidth={1.6} />
    </span>
  );
}
