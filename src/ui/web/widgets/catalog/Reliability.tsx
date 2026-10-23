import { useTranslation } from "react-i18next";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { useReliability } from "@/hooks/queries.ts";
import { TREND_CHART } from "@/lib/chartConfig.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { formatDuration } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { ProviderReliability } from "@/lib/types.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useNames, useSliceIds } from "./shared.ts";
import { Fill, WidgetCard } from "./WidgetCard.tsx";

/** Weighted means: a provider with ten incidents says more about repair time than one with a single one. */
function fleet(rows: readonly ProviderReliability[], days: number) {
  const resolved = rows.reduce((a, r) => a + r.resolved, 0);
  const mttr =
    resolved === 0 ? null : rows.reduce((a, r) => a + (r.mttrMinutes ?? 0) * r.resolved, 0) / resolved;
  const incidents = rows.reduce((a, r) => a + r.incidents, 0);
  const previous = rows.reduce((a, r) => a + r.previousIncidents, 0);
  return { mttr, mtbf: incidents === 0 ? null : (days * 1440) / incidents, incidents, previous };
}

/**
 * Mean time to repair and between failures over ninety days — the two numbers
 * a vendor review is argued with. Each bar is scaled against the worst in the
 * slice, so "longest repairs" and "breaks most often" are read off the length.
 */
export function Reliability({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useReliability(OVERVIEW_WINDOW_DAYS);
  const title = t("dashboard.widget.reliability.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = data.providers
    .filter((r) => slice.ids.has(r.providerId) && r.incidents > 0)
    .sort((a, b) => b.incidents - a.incidents);
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${t("widget.reliability.meta", { days: data.days })}`;
  const duration = (minutes: number | null) => (minutes === null ? "—" : formatDuration(i18n.language, minutes));

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.reliability.none", { days: data.days })}</p>
      </WidgetCard>
    );
  }

  const total = fleet(rows, data.days);
  const longestRepair = Math.max(1, ...rows.map((r) => r.mttrMinutes ?? 0));
  const frequent = rows.reduce((a, b) => ((a.mtbfMinutes ?? Infinity) <= (b.mtbfMinutes ?? Infinity) ? a : b));
  const slowest = rows.reduce((a, b) => ((a.mttrMinutes ?? 0) >= (b.mttrMinutes ?? 0) ? a : b));
  const conclusion =
    frequent.providerId === slowest.providerId
      ? t("widget.reliability.both", { provider: name(frequent.providerId), mtbf: duration(frequent.mtbfMinutes), mttr: duration(slowest.mttrMinutes) })
      : t("widget.reliability.split", {
          frequent: name(frequent.providerId),
          mtbf: duration(frequent.mtbfMinutes),
          slowest: name(slowest.providerId),
          mttr: duration(slowest.mttrMinutes),
        });
  const trend = (r: ProviderReliability) => {
    const delta = r.incidents - r.previousIncidents;
    if (r.previousIncidents === 0 && r.incidents === 0) return { text: "—", color: undefined };
    if (delta === 0) return { text: t("widget.reliability.same"), color: undefined };
    return {
      text: t("widget.reliability.delta", { delta: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}` }),
      color: delta > 0 ? TREND_CHART.fall : TREND_CHART.rise,
    };
  };

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      {/* A third: the slice as two numbers. */}
      <div className="grid grid-cols-2 gap-3 @md:hidden">
        <div className="flex flex-col">
          <span className="font-mono text-2xl">{duration(total.mttr)}</span>
          <span className="font-mono text-xs text-muted-foreground">{t("widget.reliability.mttr")}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-2xl">{duration(total.mtbf)}</span>
          <span className="font-mono text-xs text-muted-foreground">{t("widget.reliability.mtbf")}</span>
        </div>
        <span className="col-span-2 text-sm text-muted-foreground">
          <NumberTicker locale={i18n.language} value={total.incidents} /> {t("widget.reliability.incidents-word", { count: total.incidents })}
          {total.previous > 0 && ` · ${t("widget.reliability.before", { count: total.previous })}`}
        </span>
      </div>

      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_4rem] items-center gap-x-4 gap-y-0 @md:grid @2xl:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_5rem_7rem]">
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.reliability.provider")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.reliability.mttr")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.reliability.mtbf")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.reliability.incidents")}</span>
        <span className="hidden pb-1.5 text-right font-mono text-xs text-muted-foreground @2xl:block">{t("widget.reliability.versus")}</span>
        {rows.map((row, index) => {
          const change = trend(row);
          const delay = stagger(index, { base: 200, step: 60 });
          return (
            <div key={row.providerId} className="contents">
              <span className="truncate border-t border-border py-2.5 text-sm">{name(row.providerId)}</span>
              <div className="flex flex-col gap-1 border-t border-border py-2.5">
                <span className="font-mono text-sm">{duration(row.mttrMinutes)}</span>
                <Fill value={(row.mttrMinutes ?? 0) / longestRepair} color="var(--color-accent)" className="h-1.5" delay={delay} />
              </div>
              <div className="flex flex-col gap-1 border-t border-border py-2.5">
                <span className="font-mono text-sm">{row.mtbfMinutes === null ? t("widget.reliability.once") : duration(row.mtbfMinutes)}</span>
                {/* Shorter between failures is worse, so the bar is how often, not how long. */}
                <Fill
                  value={row.mtbfMinutes === null ? 0 : (frequent.mtbfMinutes ?? 1) / row.mtbfMinutes}
                  color="var(--status-degraded)"
                  className="h-1.5"
                  delay={delay}
                />
              </div>
              <span className="border-t border-border py-2.5 font-mono text-sm">{row.incidents}</span>
              <span className="hidden border-t border-border py-2.5 text-right font-mono text-xs @2xl:block" style={{ color: change.color }}>
                {change.text}
              </span>
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}
