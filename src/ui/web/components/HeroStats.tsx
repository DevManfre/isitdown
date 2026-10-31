import { Trans, useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { UptimeArc } from "@/components/charts/UptimeArc.tsx";
import { DrillLink } from "@/components/DrillLink.tsx";
import { formatPercent } from "@/lib/format.ts";
import { historyHref } from "@/lib/drillDown.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { shownStatus } from "@/lib/suspicion.ts";

/**
 * The hero's right-hand column: the one figure the fleet adds up to, and the
 * three lines that qualify it.
 *
 * It is the answer to a question the hero's sentence deliberately does not
 * answer — the headline says whether anything is wrong right now, this says how
 * the last ninety days went and whether the last cycle even completed. Two
 * different questions, side by side, which is why the aggregate is not folded
 * into the sentence.
 *
 * Fixed height by construction: three lines and an arc, whatever the fleet's
 * size. The same reason `FleetSummary` exists for the dense shape — nothing in
 * the hero may grow with the number of providers.
 */
export function HeroStats({ providers, average }: { providers: ProviderStatus[]; average: number }) {
  const { t, i18n } = useTranslation();

  // Roadmap 1.3: a hatched suspicion keeps the page's word here, as in the
  // headline; an `observed` one is the record and counts.
  const alarm = providers.filter((p) => {
    const shown = shownStatus(p);
    return (shown.hatched ? p.overallStatus : shown.status) !== "operational";
  }).length;
  const answered = providers.filter((p) => p.failureCount === 0 && p.fetchedAt !== null).length;

  const rows = [
    {
      key: "uptime",
      label: t("overview.stat.providers"),
      value: (
        <Trans
          i18nKey="overview.stat.mix"
          values={{ up: providers.length - alarm, alarm }}
          components={[
            <NumberTicker locale={i18n.language} value={providers.length - alarm} />,
            <NumberTicker locale={i18n.language} value={alarm} />,
          ]}
        />
      ),
    },
    {
      key: "cycle",
      label: t("overview.stat.cycle"),
      value: (
        <Trans
          i18nKey="overview.stat.answered"
          values={{ answered, total: providers.length }}
          components={[
            <NumberTicker locale={i18n.language} value={answered} />,
            <NumberTicker locale={i18n.language} value={providers.length} />,
          ]}
        />
      ),
    },
  ];

  return (
    <div
      data-slot="hero-stats"
      data-testid="hero-stats"
      className="hero-stats anim-rise anim-rise-hero flex min-w-0 items-center gap-5 border-border lg:border-l lg:pl-6"
      style={{ animationDelay: "120ms" }}
    >
      <UptimeArc value={average} size={112} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("overview.summary.window")}
          </span>
          <DrillLink
            to={historyHref({ days: OVERVIEW_WINDOW_DAYS })}
            // The figure is in the name as well as on screen: an accessible name that
            // leaves out the visible text fails WCAG 2.5.3 (axe, roadmap 4.20), and
            // a voice-control user says what they see.
            label={t("drill.fleet-uptime", { count: OVERVIEW_WINDOW_DAYS, uptime: formatPercent(i18n.language, average) })}
            where={t("drill.where.history-fleet", { count: OVERVIEW_WINDOW_DAYS })}
            className="w-fit font-mono text-sm"
          >
            <NumberTicker locale={i18n.language} value={average} decimalPlaces={2} suffix="%" />
          </DrillLink>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-0.5 border-t border-border pt-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {row.label}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
