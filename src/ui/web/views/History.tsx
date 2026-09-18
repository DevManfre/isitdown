import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { DeltaChip } from "@/components/DeltaChip.tsx";
import { DownloadMenu } from "@/components/DownloadMenu.tsx";
import { ProviderHistoryDrawer } from "@/components/ProviderHistoryDrawer.tsx";
import { ProviderTrendRow } from "@/components/ProviderTrendRow.tsx";
import { StatTiles } from "@/components/StatTiles.tsx";
import { MonthColumns } from "@/components/charts/MonthColumns.tsx";
import { UptimeCompareChart } from "@/components/charts/UptimeCompareChart.tsx";
import { UptimeTrendChart } from "@/components/charts/UptimeTrendChart.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { CoverageProvider } from "@/lib/coverage.tsx";
import { COMPARE_CHART } from "@/lib/chartConfig.ts";
import { formatDuration } from "@/lib/format.ts";
import { Input } from "@/components/ui/input.tsx";
import { alignSeries, uptimeForRange } from "@/lib/history.ts";
import type { HistoryWindow } from "@/lib/api.ts";
import { stagger } from "@/lib/stagger.ts";
import type { HistorySummary, ProviderHistory } from "@/lib/types.ts";

const RANGES = [7, 30, 90] as const;

/** The fourth pill: not a span, a way of asking for two dates (roadmap 5.5). */
const CUSTOM = "custom";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dayKey = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** How many days a range covers, both ends included. */
const spanOf = (range: { from: string; to: string }): number =>
  Math.max(
    1,
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) -
        Date.parse(`${range.from}T00:00:00Z`)) /
        MS_PER_DAY,
    ) + 1,
  );

/** The fixed window an operator was on, written as the two dates it means. */
const rangeEndingToday = (days: number): { from: string; to: string } => {
  const today = Date.now();
  return { from: dayKey(today - (days - 1) * MS_PER_DAY), to: dayKey(today) };
};

/** The widest fixed window a picked range fits inside, for the CSV link. */
const nearestFixed = (days: number): number =>
  RANGES.find((range) => days <= range) ?? 90;

const monthLabel = (locale: string, month: string) =>
  new Intl.DateTimeFormat(locale, { month: "short" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

/**
 * `getHistory(days)` with no provider always resolves to a `HistorySummary`;
 * `aggregateUptime` is the field unique to that shape in the union. A named
 * predicate (rather than an inline `"aggregateUptime" in data` check) so the
 * narrowed type survives past the guard cleanly.
 */
const isSummary = (
  data: HistorySummary | ProviderHistory,
): data is HistorySummary => "aggregateUptime" in data;

/** A history window is a plain JSON download — the server already served exactly this payload. */
function downloadHistoryJson(summary: HistorySummary, days: number): void {
  const blob = new Blob([JSON.stringify(summary, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `history-${days}d.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * A trend view: the daily-uptime area chart is the hero, with the headline
 * percentage, its delta against the previous window of equal length, and the
 * month columns underneath — then one labelled row per provider, worst first,
 * carrying a sparkline and a single figure. Everything else a provider has to
 * say is a click away in `ProviderHistoryDrawer`.
 *
 * The range control re-requests `/history` instead of re-slicing what is
 * already loaded, so the server stays the only place uptime is computed —
 * changing `days` changes `useHistory`'s own query key.
 */
export function History() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number>(90);
  /**
   * The picked range, or null while one of the fixed windows is selected
   * (roadmap 5.5). Kept beside `days` rather than replacing it: everything on
   * this page labels the window by its span, and a range is a span with two
   * ends rather than a different kind of thing.
   */
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const window_: HistoryWindow =
    range === null ? { days } : { days: spanOf(range), range };
  // The provider the command palette (roadmap 5.4) asked for, if any. Route
  // state rather than a url because there is no per-provider route yet (5.6);
  // read in an effect as well as initially, since navigating here from here
  // re-renders this view rather than remounting it.
  const location = useLocation();
  const asked =
    (location.state as { openProvider?: string } | null)?.openProvider ?? null;
  const [open, setOpen] = useState<string | null>(asked);
  useEffect(() => {
    if (asked !== null) setOpen(asked);
  }, [asked]);
  // Null means "whichever the ordering picks": the fleet is not loaded yet on
  // the first render, and a comparison the operator did choose must survive a
  // range change that reorders the list under it.
  const [compare, setCompare] = useState<{
    left: string | null;
    right: string | null;
  }>({
    left: null,
    right: null,
  });
  const { data } = useHistory(window_);
  const { data: status } = useStatus();

  // useHistory throws on an initial-load failure (routes.tsx's errorElement
  // catches it); while still in flight there is nothing to render yet.
  if (data === undefined) return null;
  if (!isSummary(data)) return null;
  const summary = data;

  const statusById = new Map(
    (status?.providers ?? []).map((provider) => [provider.id, provider]),
  );

  // Worst first. Alphabetical order buries the two providers this page exists to
  // show: on a fleet where five sit at 100%, it puts the interesting rows last.
  const ordered = [...summary.providers].sort(
    (left, right) =>
      uptimeForRange(left, days) - uptimeForRange(right, days) ||
      left.providerId.localeCompare(right.providerId),
  );

  const nameOf = (providerId: string) =>
    statusById.get(providerId)?.name ?? providerId;

  // `ordered` is worst-first, so the two ends of it are the two tiles; the
  // other two are sums over the window. Empty fleets never reach the tiles
  // (the block is gated on `ordered.length`), so the non-null assertions here
  // are the same guard read twice.
  const worst = ordered[0] as ProviderHistory;
  const best = ordered[ordered.length - 1] as ProviderHistory;
  const totalIncidents = summary.providers.reduce(
    (sum, p) => sum + p.incidentCount,
    0,
  );
  const totalDowntime = summary.providers.reduce(
    (sum, p) => sum + p.downtimeMinutes,
    0,
  );
  const percent = (value: number): string =>
    `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value)}%`;

  /**
   * The two worst by default (roadmap 5.7): the page already ranks worst first,
   * and "how do these two compare" is a question about the two that are
   * costing something, not about the two that happen to sort first.
   */
  const left = compare.left ?? ordered[0]?.providerId ?? null;
  const right = compare.right ?? ordered[1]?.providerId ?? null;
  const leftHistory = ordered.find((provider) => provider.providerId === left);
  const rightHistory = ordered.find(
    (provider) => provider.providerId === right,
  );

  const picker = (side: "left" | "right", value: string) => (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: COMPARE_CHART[side] }}
      />
      <Select
        value={value}
        onValueChange={(next) => {
          // Picking the provider that is already on the other side swaps them:
          // a provider drawn against itself is the one comparison with nothing
          // to say, and a click that silently did nothing would read as a
          // broken control.
          const other = side === "left" ? right : left;
          if (next === other) {
            setCompare({ left: right, right: left });
            return;
          }
          setCompare({ left, right, [side]: next });
        }}
      >
        {/* Both keys spelled out rather than built from `side`: a key assembled
            at runtime is invisible to the catalog guard, which is what keeps a
            dead or missing string from shipping. */}
        <SelectTrigger
          size="sm"
          aria-label={
            side === "left"
              ? t("history.compare.left")
              : t("history.compare.right")
          }
          className="w-44"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ordered.map((provider) => (
            <SelectItem key={provider.providerId} value={provider.providerId}>
              {nameOf(provider.providerId)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    // Roadmap 10.1: every bar under here is drawn against the poller's own
    // liveness, so a day it missed part of reads as hatched rather than as a
    // quiet day.
    <CoverageProvider coverage={summary.dailyCoverage}>
      <div className="flex flex-col gap-6">
        <div
          className="anim-rise anim-rise-column flex flex-col gap-4"
          style={{ animationDelay: "0ms" }}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-primary">
                {t("history.kicker")}
              </span>
              <span className="font-mono text-3xl font-medium">
                <NumberTicker
                  locale={i18n.language}
                  value={summary.aggregateUptime}
                  decimalPlaces={2}
                  suffix="%"
                />
              </span>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-sm text-muted-foreground">
                  <Trans
                    i18nKey="history.subtitle"
                    values={{ count: summary.providers.length, days }}
                    components={[
                      <NumberTicker
                        locale={i18n.language}
                        value={summary.providers.length}
                      />,
                    ]}
                  />
                </span>
                <DeltaChip delta={summary.aggregateDelta} days={days} />
              </div>
              {/* The caveat the percentage above cannot carry on its own — roadmap
                10.1. Shown only when there is something to say: a window the
                poller covered throughout needs no sentence, and printing one
                every time would train the operator to stop reading it. */}
              {summary.coverage !== null && summary.coverage < 1 && (
                <span
                  className="text-xs text-muted-foreground"
                  data-coverage={summary.coverage}
                >
                  {t("coverage.partial", {
                    percent: new Intl.NumberFormat(i18n.language, {
                      style: "percent",
                      maximumFractionDigits: 1,
                    }).format(summary.coverage),
                  })}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {range === null
                  ? t("history.range-active", { days })
                  : t("history.range-custom-active", {
                      from: range.from,
                      to: range.to,
                    })}
              </span>
              <ToggleGroup
                type="single"
                value={range === null ? String(days) : CUSTOM}
                onValueChange={(next) => {
                  if (next === "") return;
                  if (next === CUSTOM) {
                    // Opens on the window already on screen, so the first thing
                    // the picker shows is what the operator was just looking at.
                    setRange(rangeEndingToday(days));
                    return;
                  }
                  setRange(null);
                  setDays(Number(next));
                }}
              >
                {/* The visible label stays the prototype's compact "7d" pill; the
                  accessible name is the spelled-out translated range, so a
                  screen reader hears "Last 7 days" rather than the bare token.
                  The sighted operator now reads the active range from the label
                  beside the group instead of inferring it from the pressed pill. */}
                {RANGES.map((range) => (
                  <ToggleGroupItem
                    key={range}
                    value={String(range)}
                    aria-label={t("column.range", { days: range })}
                  >
                    {`${range}d`}
                  </ToggleGroupItem>
                ))}
                <ToggleGroupItem
                  value={CUSTOM}
                  aria-label={t("history.range-custom")}
                >
                  {t("history.range-custom")}
                </ToggleGroupItem>
              </ToggleGroup>
              {range !== null && (
                // Native date inputs: the browser already localises them, and a
                // calendar popover would be a new surface for what is two dates.
                <span className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="history-from">
                    {t("history.range-from")}
                  </label>
                  <Input
                    id="history-from"
                    type="date"
                    className="h-8 w-[10.5rem]"
                    value={range.from}
                    max={range.to}
                    onChange={(event) =>
                      setRange({ ...range, from: event.target.value })
                    }
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    —
                  </span>
                  <label className="sr-only" htmlFor="history-to">
                    {t("history.range-to")}
                  </label>
                  <Input
                    id="history-to"
                    type="date"
                    className="h-8 w-[10.5rem]"
                    value={range.to}
                    min={range.from}
                    onChange={(event) =>
                      setRange({ ...range, to: event.target.value })
                    }
                  />
                </span>
              )}
              {/* The CSV is the server's own aggregation rather than this summary
                flattened here (roadmap 4.6): one row per provider per day is a
                shape the JSON payload does not have, and deriving it in the
                browser would be a second definition of a daily bucket. A link,
                because the answer is a download; the JSON is built here because
                the payload on screen already is the answer. */}
              <DownloadMenu
                groups={[
                  {
                    label: t("history.range-active", { days }),
                    items: [
                      {
                        format: "JSON",
                        description: t("history.download", { days }),
                        onSelect: () => downloadHistoryJson(summary, days),
                      },
                      {
                        format: "CSV",
                        description: t("history.download-csv", { days }),
                        // The export still takes one of the three fixed windows
                        // (roadmap 4.6), so a picked range downloads the span it
                        // rounds to rather than offering a file the server has no
                        // way to produce.
                        href: `/export/history.csv?days=${nearestFixed(days)}`,
                      },
                    ],
                  },
                  {
                    // Roadmap 4.7. Not another shape of the same rows: the
                    // server writes the month up — uptime per provider, worst
                    // day, the incidents behind it — because what somebody does
                    // with a month of uptime is paste it into a ticket, not open
                    // it in a spreadsheet. One entry per month the columns below
                    // show, so the link is for the month being looked at.
                    label: t("history.report-title"),
                    items: summary.months.map((month) => ({
                      format: monthLabel(i18n.language, month.month),
                      description: t("history.report-download", {
                        month: monthLabel(i18n.language, month.month),
                      }),
                      href: `/export/monthly.md?month=${month.month}`,
                    })),
                  },
                ]}
              />
            </div>
          </div>

          {/* The window's four figures, before the first chart. The aggregate is
            deliberately not among them — it is the page's headline two lines
            up, and a tile repeating it would be the same number twice. These
            are the ones the charts below make you read a shape to recover:
            which provider was best, which was worst, how many incidents that
            came to, and how long the fleet was actually down. */}
          {ordered.length > 0 && (
            <StatTiles
              stats={[
                {
                  id: "best",
                  label: t("history.stat.best"),
                  value: nameOf(best.providerId),
                  note: percent(uptimeForRange(best, days)),
                  accent: "var(--status-operational)",
                },
                {
                  id: "worst",
                  label: t("history.stat.worst"),
                  value: nameOf(worst.providerId),
                  note: percent(uptimeForRange(worst, days)),
                  accent: "var(--status-major-outage)",
                },
                {
                  id: "incidents",
                  label: t("history.stat.incidents"),
                  value: (
                    <NumberTicker
                      locale={i18n.language}
                      value={totalIncidents}
                    />
                  ),
                  note: t("history.stat.incidents-note", { days }),
                  accent: "var(--status-degraded)",
                },
                {
                  id: "downtime",
                  label: t("history.stat.downtime"),
                  value: formatDuration(i18n.language, totalDowntime),
                  note: t("history.stat.downtime-note", { days }),
                  accent: "var(--color-accent)",
                },
              ]}
            />
          )}

          <UptimeTrendChart
            series={summary.dailyUptime}
            label={t("history.trend-title")}
          />

          <MonthColumns
            months={summary.months}
            labelFor={(month) => monthLabel(i18n.language, month)}
            noDataLabel={t("history.month-no-data")}
            heading={t("history.months-title")}
          />
        </div>

        <div
          className="fade-rule anim-sweep h-px bg-border"
          style={{ animationDelay: "200ms" }}
        />

        {/* Two providers side by side is the question a vendor decision asks, and
          the list of rows — which ranks them but never puts two on the same
          axes — cannot answer it. A card between the two rules rather than a
          third full-width band: the headline and the month columns are one
          reading of the fleet, and this is a tool the operator drives, so it
          reads better as its own surface than as more of the hero. Only
          rendered once there are two providers to compare: one drawn against
          itself is a chart with nothing to say. */}
        {leftHistory !== undefined &&
        rightHistory !== undefined &&
        left !== right ? (
          <>
            <section
              aria-label={t("history.compare.title")}
              className="anim-rise"
              style={{ animationDelay: "120ms" }}
            >
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {t("history.compare.title")}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    {picker("left", leftHistory.providerId)}
                    {picker("right", rightHistory.providerId)}
                  </div>
                </div>
                <UptimeCompareChart
                  rows={alignSeries(leftHistory, rightHistory)}
                  leftLabel={nameOf(leftHistory.providerId)}
                  rightLabel={nameOf(rightHistory.providerId)}
                  label={t("history.compare.chart", {
                    left: nameOf(leftHistory.providerId),
                    right: nameOf(rightHistory.providerId),
                  })}
                />
              </Card>
            </section>

            <div
              className="fade-rule anim-sweep h-px bg-border"
              style={{ animationDelay: "240ms" }}
            />
          </>
        ) : null}

        {summary.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.no-data")}</p>
        ) : (
          // One grid for the whole list, with the header and every row as a
          // `subgrid` inside it. A grid per row (which is what a `flex-col` list
          // of self-contained grids gives) sizes its `auto` tracks from its own
          // content, so every row put its figure at a different x and the header
          // labelled nothing — the exact defect this list was rebuilt to fix. A
          // delta cell is also empty whenever a provider has no previous window,
          // and only shared tracks keep the columns straight through that.
          // A named region, so a query can be scoped to the list: the stat tiles
          // at the top of the page name the best and the worst provider, so a
          // provider's name is deliberately on the page twice.
          <div
            role="region"
            aria-label={t("history.list")}
            // Five shared tracks from `md` up; a plain column of cards below it,
            // where five columns would each be 60px wide. The header labels the
            // tracks, so it goes with them — each mobile card carries its own
            // figures in a shape that reads without one.
            className="history-list flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(8rem,1fr)_minmax(6rem,2fr)_auto_auto_auto] lg:items-center lg:gap-x-4"
          >
            <div className="col-span-full hidden grid-cols-subgrid items-center px-2 text-xs uppercase tracking-widest text-muted-foreground lg:grid">
              <span>{t("history.col-provider")}</span>
              <span>{t("history.col-trend")}</span>
              <span>{t("history.col-uptime", { days })}</span>
              <span>{t("history.col-delta")}</span>
              <span>{t("history.col-incidents")}</span>
            </div>
            {ordered.map((provider, index) => {
              const live = statusById.get(provider.providerId);
              return (
                <ProviderTrendRow
                  key={provider.providerId}
                  provider={provider}
                  name={live?.name ?? provider.providerId}
                  status={live?.overallStatus ?? "unknown"}
                  days={days}
                  delay={stagger(index, { base: 180, step: 36, cap: 420 })}
                  onOpen={() => setOpen(provider.providerId)}
                />
              );
            })}
          </div>
        )}

        <ProviderHistoryDrawer
          providerId={open}
          name={open === null ? "" : (statusById.get(open)?.name ?? open)}
          status={
            open === null
              ? "unknown"
              : (statusById.get(open)?.overallStatus ?? "unknown")
          }
          components={
            open === null ? [] : (statusById.get(open)?.components ?? [])
          }
          selection={
            open === null
              ? []
              : (statusById.get(open)?.componentSelection ?? [])
          }
          upcoming={
            open === null
              ? []
              : (statusById.get(open)?.maintenance.upcoming ?? [])
          }
          historyWindow={window_}
          onClose={() => setOpen(null)}
        />
      </div>
    </CoverageProvider>
  );
}
