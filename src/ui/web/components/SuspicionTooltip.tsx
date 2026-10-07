import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { formatDuration, formatTime } from "@/lib/format.ts";
import type { Suspicion } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

/**
 * What a hatched dot, ring or row means, on hover or focus — roadmap 1.3.
 *
 * The hatch alone says "not declared"; this says by whom it was measured, what
 * it said, and for how long, which is what an operator needs before deciding
 * whether to believe the probe or the page. A `null` suspicion renders the
 * child untouched, so a caller wraps every provider without branching.
 */
export function SuspicionTooltip({
  suspicion, children, className,
}: {
  suspicion: Suspicion | null;
  children: ReactNode;
  /** Layout for the focusable wrapper, e.g. `ml-auto` when the child relied on it. */
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  if (suspicion === null) return <>{children}</>;
  const minutes = Math.max(0, (Date.now() - Date.parse(suspicion.since)) / 60_000);
  return (
    <TooltipProvider>
      <Tooltip>
        {/* Focusable, so the explanation is reachable from the keyboard and not
            only on hover — the hatch is a claim, and its reason must not be
            mouse-only. */}
        <TooltipTrigger asChild>
          <span tabIndex={0} data-testid="suspicion-trigger" className={cn("inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-ring", className)}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="flex max-w-sm flex-col gap-1">
          <span className="font-semibold">
            {t("suspected.tooltip.title", { status: t(statusLabelKey(suspicion.status)).toLowerCase() })}
          </span>
          <span>{t("suspected.tooltip.unconfirmed")}</span>
          <span className="font-mono text-[11px] opacity-80">
            {[
              suspicion.probeId,
              suspicion.note,
              t("suspected.tooltip.since", {
                time: formatTime(i18n.language, suspicion.since),
                duration: formatDuration(i18n.language, minutes),
              }),
            ]
              .filter((part) => part !== undefined)
              .join(" · ")}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
