import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useTrust } from "@/hooks/queries.ts";
import { stagger } from "@/lib/stagger.ts";
import type { TrustCardData } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { useNames } from "./shared.ts";
import { Fill, WidgetCard } from "./WidgetCard.tsx";

/** The trust window the widget reads: long enough to clear the ten-episode floor. */
export const TRUST_DAYS = 90;

/** A pair that cleared the floor and has an admission delay to report. */
export const measured = (cards: readonly TrustCardData[]) =>
  cards.filter((c) => c.floor === undefined && c.delay != null);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Who says it first — roadmap 4.3's widget 13. How long after our own probe
 * saw a provider fail did its status page admit it: the trust card's admission
 * delay (roadmap 8.1), one row per page, slowest first.
 */
export function PageDelay() {
  const { t } = useTranslation();
  const name = useNames();
  const { data } = useTrust(TRUST_DAYS);
  const title = t("dashboard.widget.page-delay.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = measured(data.cards).sort((a, b) => b.delay!.medianMinutes - a.delay!.medianMinutes);
  if (rows.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.page-delay.none")}</p>
        <Link to={ROUTE_PATHS.providers} className="text-sm text-primary hover:underline">
          {t("widget.page-delay.add-probe")}
        </Link>
      </WidgetCard>
    );
  }

  const fleet = Math.round(median(rows.map((r) => r.delay!.medianMinutes)));
  const slowest = rows[0]!;
  const longest = Math.max(1, ...rows.map((r) => r.delay!.medianMinutes));
  const episodes = rows.reduce((sum, r) => sum + (r.delay?.admitted ?? 0), 0);
  const conclusion = t("widget.page-delay.conclusion", {
    minutes: fleet,
    provider: name(slowest.pair.pageId),
    slowest: Math.round(slowest.delay!.medianMinutes),
  });

  return (
    <WidgetCard
      title={title}
      meta={t("widget.page-delay.meta", { days: data.days, count: episodes })}
      conclusion={conclusion}
      className="@container"
    >
      <div className="flex items-baseline gap-2.5 @md:hidden">
        <span className="font-mono text-4xl leading-none">{t("widget.minutes", { count: fleet })}</span>
        <span className="font-mono text-xs text-muted-foreground">{t("widget.page-delay.median")}</span>
      </div>

      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_5rem_5rem] items-center gap-x-4 @md:grid">
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.col.provider")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.page-delay.col-delay")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.page-delay.col-median")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.page-delay.col-p90")}</span>
        {rows.map((row, index) => (
          <div key={row.key} className="contents">
            <span className="truncate border-t border-border py-2.5 text-sm">{name(row.pair.pageId)}</span>
            <div className="border-t border-border py-3.5">
              <Fill
                value={row.delay!.medianMinutes / longest}
                color={row.delay!.medianMinutes >= 10 ? "var(--status-degraded)" : "var(--primary)"}
                delay={stagger(index, { base: 180, step: 60 })}
              />
            </div>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm">
              {t("widget.minutes", { count: Math.round(row.delay!.medianMinutes) })}
            </span>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm text-muted-foreground">
              {t("widget.minutes", { count: Math.round(row.delay!.p90Minutes) })}
            </span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
