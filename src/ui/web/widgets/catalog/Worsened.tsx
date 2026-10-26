import { useTranslation } from "react-i18next";
import { DrillLink } from "@/components/DrillLink.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { useHistory } from "@/hooks/queries.ts";
import { TREND_CHART } from "@/lib/chartConfig.ts";
import { historyHref } from "@/lib/drillDown.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { summaryProviders } from "@/lib/history.ts";
import type { DayUptime } from "@/lib/types.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useNames, useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const WINDOW = 30;
/** Under this many points either way the change is noise, not a trend. */
const NOISE = 0.01;

const mean = (days: readonly DayUptime[]) => {
  const measured = days.map((d) => d.uptime).filter((v): v is number => v !== null);
  return measured.length === 0 ? null : measured.reduce((a, b) => a + b, 0) / measured.length;
};

/**
 * Who got worse — widget 22. The last thirty days against the thirty before,
 * per provider, the biggest fall first: the comparison a weekly review argues
 * about, without opening History and reading two windows by eye.
 */
export function Worsened({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  const title = t("dashboard.widget.worsened.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = summaryProviders(data)
    .filter((p) => slice.ids.has(p.providerId))
    .map((p) => {
      const now = mean(p.dailySeries.slice(-WINDOW));
      const then = mean(p.dailySeries.slice(-2 * WINDOW, -WINDOW));
      return { id: p.providerId, now, then, delta: now === null || then === null ? null : now - then };
    })
    .filter((r): r is { id: string; now: number; then: number; delta: number } => r.delta !== null)
    .sort((a, b) => a.delta - b.delta);
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${t("widget.worsened.meta", { count: WINDOW })}`;

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.worsened.young", { count: 2 * WINDOW })}</p>
      </WidgetCard>
    );
  }

  const fmt = (v: number) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const signed = (v: number) => t(v < 0 ? "widget.worsened.down" : "widget.worsened.up", { points: fmt(Math.abs(v)) });
  const color = (v: number) => (Math.abs(v) < NOISE ? undefined : v < 0 ? TREND_CHART.fall : TREND_CHART.rise);
  const falling = rows.filter((r) => r.delta <= -NOISE);
  const rising = rows.filter((r) => r.delta >= NOISE);
  const worst = rows[0]!;
  const conclusion =
    falling.length === 0
      ? t("widget.worsened.steady")
      : falling.length === 1
        ? t("widget.worsened.alone", { provider: name(worst.id), delta: signed(worst.delta) })
        : t("widget.worsened.conclusion", { provider: name(worst.id), delta: signed(worst.delta), count: falling.length - 1 });

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      <div className="flex flex-col gap-1 @md:hidden">
        {falling.length > 0 ? (
          <span className="flex items-baseline gap-2.5">
            <span className="text-lg">{name(worst.id)}</span>
            <span className="font-mono text-sm" style={{ color: color(worst.delta) }}>{signed(worst.delta)}</span>
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {t("widget.worsened.tally", { down: falling.length, up: rising.length })}
        </span>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_5rem_5rem_6.5rem] items-center gap-x-4 @md:grid">
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.col.provider")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.worsened.before")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.worsened.now")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.worsened.change")}</span>
        {rows.map((row) => (
          <div key={row.id} className="contents">
            <span className="truncate border-t border-border py-2.5 text-sm">{name(row.id)}</span>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm text-muted-foreground">{fmt(row.then)}%</span>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm">
              <DrillLink
                to={historyHref({ provider: row.id, days: WINDOW })}
                label={t("drill.provider-uptime", { provider: name(row.id), uptime: `${fmt(row.now)}%`, count: WINDOW })}
                where={t("drill.where.history", { provider: name(row.id), count: WINDOW })}
              >
                {fmt(row.now)}%
              </DrillLink>
            </span>
            <span className="border-t border-border py-2.5 font-mono text-sm" style={{ color: color(row.delta) }}>
              {signed(row.delta)}
            </span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
