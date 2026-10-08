import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { formatDateTime, formatDuration } from "@/lib/format.ts";
import type { StaleReading } from "@/lib/types.ts";

/**
 * "This reading may be the adapter's, not the page's" — roadmap 1.8.
 *
 * A badge rather than a colour: the status beside it is still the page's last
 * word as read, and may well be right. What the badge says is that IsItDown can
 * no longer vouch for it, and the tooltip says why. A `null` reading renders
 * nothing, so a caller passes every provider's field without branching.
 */
export function StaleBadge({ stale }: { stale: StaleReading | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (stale === null || stale === undefined) return null;
  const since = formatDateTime(i18n.language, stale.since);
  const reason =
    stale.reason === "shrunk"
      ? t("stale.tooltip.shrunk", { since, components: stale.components ?? 0, expected: stale.expected ?? 0 })
      : t("stale.tooltip.unchanged", {
          since,
          usual: formatDuration(i18n.language, (stale.longestStillMs ?? 0) / 60_000),
        });
  return (
    <TooltipProvider>
      <Tooltip>
        {/* Focusable for the same reason the suspicion hatch is: the badge is
            a claim, and its reason must not be mouse-only. */}
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            data-testid="provider-stale"
            data-reason={stale.reason}
            className="border-dashed focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("stale.badge")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="flex max-w-sm flex-col gap-1">
          <span>{reason}</span>
          <span className="opacity-80">{t("stale.tooltip.hint")}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
