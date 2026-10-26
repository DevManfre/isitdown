import { useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { DrillLink } from "@/components/DrillLink.tsx";
import { historyHref } from "@/lib/drillDown.ts";
import { useHistory } from "@/hooks/queries.ts";
import { TREND_CHART, uptimeDomain } from "@/lib/chartConfig.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { summaryProviders } from "@/lib/history.ts";
import { stagger } from "@/lib/stagger.ts";
import type { DayUptime } from "@/lib/types.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useNames, useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const WINDOW = 30;

const mean = (days: readonly DayUptime[]) => {
  const measured = days.map((d) => d.uptime).filter((v): v is number => v !== null);
  return measured.length === 0 ? null : measured.reduce((a, b) => a + b, 0) / measured.length;
};

/**
 * The line split where nothing was measured: a gap in the record is a gap in
 * the line, never a slope drawn across days nobody watched.
 */
function segments(days: readonly DayUptime[], [low, high]: [number, number]): string[] {
  const x = (i: number) => (days.length <= 1 ? 50 : (i / (days.length - 1)) * 100);
  const y = (v: number) => 26 - ((v - low) / Math.max(0.001, high - low)) * 24;
  const out: string[] = [];
  let current: string[] = [];
  days.forEach((day, i) => {
    if (day.uptime === null) {
      if (current.length > 0) out.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(day.uptime).toFixed(2)}`);
  });
  if (current.length > 0) out.push(current.join(" "));
  return out;
}

function Line({
  days,
  domain,
  delay,
  label,
}: {
  days: readonly DayUptime[];
  domain: [number, number];
  delay: string;
  label?: string | undefined;
}) {
  return (
    // Revealed left to right like a line being drawn — by clipping, not by a
    // dash offset: the svg is stretched to its row, and a dash measured along
    // a stretched path lands in the wrong place on a non-scaling stroke.
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="anim-row-sweep h-7 min-w-0 flex-1 overflow-visible"
      style={{ animationDelay: delay }}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {segments(days, domain).map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={TREND_CHART.stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * Thirty days of daily uptime per provider, on one shared scale so a wobble
 * is compared with its neighbours, not blown up to fill its own row — and the
 * change against the thirty days before, which is the number a weekly review
 * actually asks for.
 */
export function Sparklines({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  const title = t("dashboard.widget.sparklines.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = summaryProviders(data)
    .filter((p) => slice.ids.has(p.providerId))
    .map((p) => {
      const recent = p.dailySeries.slice(-WINDOW);
      const before = p.dailySeries.slice(-2 * WINDOW, -WINDOW);
      const now = mean(recent);
      const then = mean(before);
      return { id: p.providerId, recent, now, delta: now === null || then === null || before.length < WINDOW ? null : now - then };
    });
  const domain = uptimeDomain(rows.flatMap((r) => r.recent.map((d) => d.uptime)));
  const pct = (v: number) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v))}`;
  const deltaColor = (v: number | null) =>
    v === null || Math.abs(v) < 0.05 ? undefined : v > 0 ? TREND_CHART.rise : TREND_CHART.fall;
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${t("widget.sparklines.meta", { days: WINDOW })}`;

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("dashboard.empty-slice")}</p>
      </WidgetCard>
    );
  }

  const falling = rows.filter((r) => r.delta !== null && r.delta <= -0.05).sort((a, b) => a.delta! - b.delta!);
  const young = rows.filter((r) => r.delta === null);
  const conclusion =
    falling.length > 0
      ? t("widget.sparklines.falling", { count: falling.length, provider: name(falling[0]!.id), delta: signed(falling[0]!.delta!) })
      : t("widget.sparklines.steady");
  const fleetDaily = "dailyUptime" in data ? data.dailyUptime : [];
  const fleetRecent = fleetDaily.slice(-WINDOW);
  const fleetNow = mean(fleetRecent);
  const fleetThen = mean(fleetDaily.slice(-2 * WINDOW, -WINDOW));
  const fleetDelta = fleetNow === null || fleetThen === null ? null : fleetNow - fleetThen;

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      {/* A third: the slice as one line. */}
      <div className="flex flex-col gap-2 @md:hidden">
        <div className="flex items-baseline gap-2.5">
          <NumberTicker className="font-mono text-3xl" locale={i18n.language} value={slice.average} decimalPlaces={2} suffix="%" />
          {fleetDelta !== null && !slice.filtered && (
            <span className="font-mono text-xs" style={{ color: deltaColor(fleetDelta) }}>{signed(fleetDelta)}</span>
          )}
        </div>
        <div className="flex h-10">
          <Line days={fleetRecent} domain={uptimeDomain(fleetRecent.map((d) => d.uptime))} delay="160ms" label={t("widget.sparklines.fleet-label", { days: WINDOW })} />
        </div>
      </div>

      <ul className="hidden grid-cols-1 gap-x-10 gap-y-2.5 @md:grid @2xl:grid-cols-2">
        {rows.map((row, index) => (
          <li key={row.id} className="anim-fade flex min-w-0 items-center gap-3" style={{ animationDelay: stagger(index, { base: 100, step: 40 }) }}>
            <span className="w-24 shrink-0 truncate text-sm">{name(row.id)}</span>
            <Line
              days={row.recent}
              domain={domain}
              delay={stagger(index, { base: 140, step: 40 })}
              label={row.now === null ? undefined : t("widget.sparklines.row-label", { provider: name(row.id), uptime: pct(row.now), days: WINDOW })}
            />
            <span className="w-16 shrink-0 text-right font-mono text-xs">
              {row.now === null ? (
                "—"
              ) : (
                <DrillLink
                  to={historyHref({ provider: row.id, days: WINDOW })}
                  label={t("drill.provider-uptime", { provider: name(row.id), uptime: `${pct(row.now)}%`, count: WINDOW })}
                  where={t("drill.where.history", { provider: name(row.id), count: WINDOW })}
                >
                  {`${pct(row.now)}%`}
                </DrillLink>
              )}
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground" style={{ color: deltaColor(row.delta) }}>
              {row.delta === null ? "" : signed(row.delta)}
            </span>
          </li>
        ))}
      </ul>
      {young.length > 0 && (
        <p className="hidden font-mono text-xs text-muted-foreground @md:block">
          {t("widget.sparklines.young", { count: young.length, providers: young.map((r) => name(r.id)).join(", ") })}
        </p>
      )}
    </WidgetCard>
  );
}
