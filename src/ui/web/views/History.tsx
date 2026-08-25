import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { MonthColumns } from "@/components/charts/MonthColumns.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useComponentHistory, useHistory, useStatus } from "@/hooks/queries.ts";
import { formatPercent } from "@/lib/format.ts";
import type { ComponentHistory, ComponentStatus, HistorySummary, OverallStatus, ProviderHistory } from "@/lib/types.ts";

const RANGES = [7, 30, 90] as const;

const SEVERITY: Record<string, number> = { operational: 1, unknown: 0, degraded: 2, partial_outage: 3, major_outage: 4 };
const severity = (status: string) => SEVERITY[status] ?? 0;

const monthLabel = (locale: string, month: string) =>
  new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(`${month}-01T00:00:00Z`));

const uptimeFor = (component: ComponentHistory, days: number) =>
  (days <= 7 ? component.uptime7 : days <= 30 ? component.uptime30 : component.uptime90);

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
 * Per-component breakdown under a provider's own row. Mounted only when that
 * provider has a non-empty `componentSelection` (the parent decides), so the
 * `/history/components` request never fires for the common case of a
 * provider with nothing selected — same gating as history.js:54.
 */
function ComponentRows({
  providerId, days, current,
}: {
  providerId: string;
  days: number;
  current: ComponentStatus[];
}) {
  const { t, i18n } = useTranslation();
  const { data } = useComponentHistory(providerId, days);
  if (data === undefined) return null;

  const currentById = new Map(current.map((component) => [component.id, component]));

  return (
    <div className="component-rows flex flex-col gap-2 border-t border-border pt-3">
      <span className="text-xs uppercase tracking-widest text-primary">{t("components.rows-title")}</span>
      {data.components.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("components.unsupported")}</p>
      ) : (
        data.components.map((component) => {
          const live = currentById.get(component.componentId);
          const never = component.sampleCount === 0;
          return (
            <div key={component.componentId} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <StatusDot status={live?.status ?? "unknown"} size={7} />
                <span className="truncate">{live?.name ?? component.name}</span>
              </span>
              <UptimeStrip buckets={component.buckets} />
              <span className={`font-mono text-xs ${never ? "text-muted-foreground" : ""}`}>
                {never ? t("components.never-measured") : formatPercent(i18n.language, uptimeFor(component, days))}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function ProviderBlock({
  provider, name, days, delay, selection, current,
}: {
  provider: ProviderHistory;
  name: string;
  days: number;
  delay: number;
  selection: { id: string; name: string }[];
  current: ComponentStatus[];
}) {
  const { t, i18n } = useTranslation();
  const worst = provider.buckets.reduce<OverallStatus>(
    (acc, bucket) => (severity(bucket.status) > severity(acc) ? bucket.status : acc),
    "operational",
  );

  return (
    <div className="history-row anim-rise flex flex-col gap-2" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot status={worst} />
          <span className="provider-name text-sm">{name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
          <span>{`7d ${formatPercent(i18n.language, provider.uptime7)}`}</span>
          <span>{`30d ${formatPercent(i18n.language, provider.uptime30)}`}</span>
          <span style={{ color: "var(--color-neutral-300)" }}>{`90d ${formatPercent(i18n.language, provider.uptime90)}`}</span>
          <span>
            {t("history.incidents", { count: provider.incidentCount })}
            {" · "}
            <span>{t("history.downtime", { minutes: provider.downtimeMinutes })}</span>
          </span>
        </div>
      </div>
      <UptimeBarRow buckets={provider.buckets} scale="row" />
      {selection.length > 0 && <ComponentRows providerId={provider.providerId} days={days} current={current} />}
    </div>
  );
}

/**
 * Design 3a's History view: aggregate uptime figure plus four month columns,
 * then one block per provider carrying its 7/30/90-day figures and daily bar
 * row. Straight port of src/ui/public/js/views/history.js.
 *
 * The range control re-requests `/history` instead of re-slicing what is
 * already loaded, so the server stays the only place uptime is computed —
 * changing `days` changes `useHistory`'s own query key.
 */
export function History() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number>(90);
  const { data } = useHistory(days);
  const { data: status } = useStatus();

  // useHistory throws on an initial-load failure (routes.tsx's errorElement
  // catches it); while still in flight there is nothing to render yet.
  if (data === undefined) return null;
  if (!isSummary(data)) return null;
  const summary = data;

  const statusById = new Map((status?.providers ?? []).map((provider) => [provider.id, provider]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="anim-rise anim-rise-column flex flex-col gap-2" style={{ animationDelay: "0ms" }}>
          <span className="text-xs uppercase tracking-widest text-primary">{t("history.kicker")}</span>
          <span className="font-mono text-3xl font-medium">{formatPercent(i18n.language, summary.aggregateUptime)}</span>
          <span className="text-sm text-muted-foreground">
            {t("history.subtitle", { count: summary.providers.length, days })}
          </span>
        </div>

        <div className="flex flex-col items-end gap-3">
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(next) => {
              if (next === "") return;
              setDays(Number(next));
            }}
          >
            {/* The visible label stays the prototype's compact "7d" pill (design
                3a sets it at 11px / 3px 9px, and a row of "Last 30 days" does
                not fit that control). The accessible name is the spelled-out,
                translated range, so a screen reader hears "Last 7 days" rather
                than the bare token "7d". */}
            {RANGES.map((range) => (
              <ToggleGroupItem
                key={range}
                value={String(range)}
                aria-label={t("column.range", { days: range })}
              >
                {`${range}d`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <MonthColumns
            months={summary.months}
            labelFor={(month) => monthLabel(i18n.language, month)}
            noDataLabel={t("history.month-no-data")}
          />
        </div>
      </div>

      <div className="fade-rule anim-sweep h-px bg-border" style={{ animationDelay: "200ms" }} />

      {summary.providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty.no-data")}</p>
      ) : (
        <div className="history-list flex flex-col gap-5">
          {summary.providers.map((provider, index) => {
            const live = statusById.get(provider.providerId);
            return (
              <ProviderBlock
                key={provider.providerId}
                provider={provider}
                name={live?.name ?? provider.providerId}
                days={days}
                delay={index * 80}
                selection={live?.componentSelection ?? []}
                current={live?.components ?? []}
              />
            );
          })}
        </div>
      )}

      <div className="header-actions flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("history.export")}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="font-mono text-xs"
          title={t("history.export-aria", { days })}
          onClick={() => downloadHistoryJson(summary, days)}
        >
          {`GET /history?days=${days}`}
        </Button>
      </div>
    </div>
  );
}
