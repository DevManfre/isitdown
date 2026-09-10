import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { DeltaChip } from "@/components/DeltaChip.tsx";
import { ProviderHistoryDrawer } from "@/components/ProviderHistoryDrawer.tsx";
import { ProviderTrendRow } from "@/components/ProviderTrendRow.tsx";
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
import { COMPARE_CHART } from "@/lib/chartConfig.ts";
import { alignSeries, uptimeForRange } from "@/lib/history.ts";
import { stagger } from "@/lib/stagger.ts";
import type { HistorySummary, ProviderHistory } from "@/lib/types.ts";

const RANGES = [7, 30, 90] as const;

const monthLabel = (locale: string, month: string) =>
  new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * `getHistory(days)` with no provider always resolves to a `HistorySummary`;
 * `aggregateUptime` is the field unique to that shape in the union. A named
 * predicate (rather than an inline `"aggregateUptime" in data` check) so the
 * narrowed type survives past the guard cleanly.
 */
const isSummary = (data: HistorySummary | ProviderHistory): data is HistorySummary =>
  "aggregateUptime" in data;

/** A history window is a plain JSON download — the server already served exactly this payload. */
function downloadHistoryJson(summary: HistorySummary, days: number): void {
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
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
  const [open, setOpen] = useState<string | null>(null);
  // Null means "whichever the ordering picks": the fleet is not loaded yet on
  // the first render, and a comparison the operator did choose must survive a
  // range change that reorders the list under it.
  const [compare, setCompare] = useState<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });
  const { data } = useHistory(days);
  const { data: status } = useStatus();

  // useHistory throws on an initial-load failure (routes.tsx's errorElement
  // catches it); while still in flight there is nothing to render yet.
  if (data === undefined) return null;
  if (!isSummary(data)) return null;
  const summary = data;

  const statusById = new Map((status?.providers ?? []).map((provider) => [provider.id, provider]));

  // Worst first. Alphabetical order buries the two providers this page exists to
  // show: on a fleet where five sit at 100%, it puts the interesting rows last.
  const ordered = [...summary.providers].sort(
    (left, right) =>
      uptimeForRange(left, days) - uptimeForRange(right, days) ||
      left.providerId.localeCompare(right.providerId),
  );

  const nameOf = (providerId: string) => statusById.get(providerId)?.name ?? providerId;

  /**
   * The two worst by default (roadmap 5.7): the page already ranks worst first,
   * and "how do these two compare" is a question about the two that are
   * costing something, not about the two that happen to sort first.
   */
  const left = compare.left ?? ordered[0]?.providerId ?? null;
  const right = compare.right ?? ordered[1]?.providerId ?? null;
  const leftHistory = ordered.find((provider) => provider.providerId === left);
  const rightHistory = ordered.find((provider) => provider.providerId === right);

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
          aria-label={side === "left" ? t("history.compare.left") : t("history.compare.right")}
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
    <div className="flex flex-col gap-6">
      <div className="anim-rise anim-rise-column flex flex-col gap-4" style={{ animationDelay: "0ms" }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-primary">{t("history.kicker")}</span>
            <span className="font-mono text-3xl font-medium">
              <NumberTicker locale={i18n.language} value={summary.aggregateUptime} decimalPlaces={2} suffix="%" />
            </span>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-sm text-muted-foreground">
                <Trans
                  i18nKey="history.subtitle"
                  values={{ count: summary.providers.length, days }}
                  components={[<NumberTicker locale={i18n.language} value={summary.providers.length} />]}
                />
              </span>
              <DeltaChip delta={summary.aggregateDelta} days={days} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("history.range-active", { days })}</span>
            <ToggleGroup
              type="single"
              value={String(days)}
              onValueChange={(next) => {
                if (next === "") return;
                setDays(Number(next));
              }}
            >
              {/* The visible label stays the prototype's compact "7d" pill; the
                  accessible name is the spelled-out translated range, so a
                  screen reader hears "Last 7 days" rather than the bare token.
                  The sighted operator now reads the active range from the label
                  beside the group instead of inferring it from the pressed pill. */}
              {RANGES.map((range) => (
                <ToggleGroupItem key={range} value={String(range)} aria-label={t("column.range", { days: range })}>
                  {`${range}d`}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => downloadHistoryJson(summary, days)}
            >
              {t("history.download", { days })}
            </Button>
            {/* The CSV is the server's own aggregation rather than this summary
                flattened here (roadmap 4.6): one row per provider per day is a
                shape the JSON payload does not have, and deriving it in the
                browser would be a second definition of a daily bucket. A link,
                because the answer is a download. */}
            <Button asChild variant="ghost" size="sm">
              <a href={`/export/history.csv?days=${days}`}>{t("history.download-csv", { days })}</a>
            </Button>
          </div>
        </div>

        <UptimeTrendChart series={summary.dailyUptime} label={t("history.trend-title")} />

        <MonthColumns
          months={summary.months}
          labelFor={(month) => monthLabel(i18n.language, month)}
          noDataLabel={t("history.month-no-data")}
          heading={t("history.months-title")}
        />
      </div>

      {/* Two providers side by side is the question a vendor decision asks, and
          the list of rows — which ranks them but never puts two on the same
          axes — cannot answer it. Only rendered once there are two providers
          to compare: one drawn against itself is a chart with nothing to say. */}
      {leftHistory !== undefined && rightHistory !== undefined && left !== right ? (
        <section
          aria-label={t("history.compare.title")}
          className="anim-rise flex flex-col gap-3"
          style={{ animationDelay: "120ms" }}
        >
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
        </section>
      ) : null}

      <div className="fade-rule anim-sweep h-px bg-border" style={{ animationDelay: "200ms" }} />

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
        <div className="history-list grid grid-cols-[minmax(8rem,1fr)_minmax(6rem,2fr)_auto_auto_auto] items-center gap-x-4">
          <div className="col-span-full grid grid-cols-subgrid items-center px-2 text-xs uppercase tracking-widest text-muted-foreground">
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
        status={open === null ? "unknown" : (statusById.get(open)?.overallStatus ?? "unknown")}
        components={open === null ? [] : (statusById.get(open)?.components ?? [])}
        selection={open === null ? [] : (statusById.get(open)?.componentSelection ?? [])}
        upcoming={open === null ? [] : (statusById.get(open)?.maintenance.upcoming ?? [])}
        days={days}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
