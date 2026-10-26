import type { ReactNode } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { FROM_OVERVIEW, FROM_PARAM } from "@/lib/drillDown.ts";
import { cn } from "@/lib/utils.ts";

/**
 * A number that opens its own rows — roadmap 4.3.
 *
 * A dotted underline at rest rather than link blue: every widget has several
 * of these, and a grid of blue figures would read as a page of links instead of
 * a dashboard. The tooltip names where the click goes and with which filters,
 * so it is never a surprise; `label` is the spoken name, which carries the
 * number and the destination together.
 */
export function DrillLink({
  to,
  label,
  where,
  className,
  children,
}: {
  to: string;
  /** The accessible name: the figure and where it leads, as one sentence. */
  label: string;
  /** The tooltip: the destination view, then its filters. */
  where: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            aria-label={label}
            data-slot="drill-link"
            className={cn(
              "rounded-sm underline decoration-current/35 decoration-dotted decoration-1 underline-offset-4 transition-colors hover:text-primary hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
              className,
            )}
          >
            {children}
          </Link>
        </TooltipTrigger>
        <TooltipContent>{where}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * What a drill-down narrowed the destination to, and the way back out of it.
 * The "from the Overview" kicker only when the address says so; the narrowing
 * itself is always shown, since a provider filter has no other control to
 * undo it with.
 */
export function FromOverviewChip({
  params,
  summary,
  clearLabel,
  onClear,
}: {
  params: URLSearchParams;
  summary: string;
  clearLabel: string;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const fromOverview = params.get(FROM_PARAM) === FROM_OVERVIEW;
  return (
    <span
      data-slot="from-overview"
      className="inline-flex min-h-8 w-fit items-center gap-2 rounded-full border border-primary/50 bg-primary/10 py-0.5 pr-1 pl-3 text-xs"
    >
      {fromOverview && (
        <span className="font-mono text-[0.65rem] tracking-wider text-primary uppercase">{t("drill.from-overview")}</span>
      )}
      <span>{summary}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-foreground"
      >
        <X aria-hidden="true" className={cn("size-3.5")} />
      </button>
    </span>
  );
}
