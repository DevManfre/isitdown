import { Trans, useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { UptimeArc } from "@/components/charts/UptimeArc.tsx";
import type { ProviderStatus } from "@/lib/types.ts";

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

  const alarm = providers.filter((p) => p.overallStatus !== "operational").length;
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
      className="hero-stats anim-rise anim-rise-hero flex items-center gap-5 border-border md:border-l md:pl-6"
      style={{ animationDelay: "120ms" }}
    >
      <UptimeArc value={average} size={112} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("overview.summary.window")}
          </span>
          <span className="font-mono text-sm">
            <NumberTicker locale={i18n.language} value={average} decimalPlaces={2} suffix="%" />
          </span>
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
