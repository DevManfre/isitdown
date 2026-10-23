import { useTranslation } from "react-i18next";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { useMaintenances } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatDuration } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { MaintenanceRow } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { DAY, MINUTE, useNames, useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

/** How far ahead the widget looks: two weeks is a sprint, and a maintenance announced further out is not tonight's problem. */
const HORIZON_DAYS = 14;
/**
 * Most windows drawn. An edge network announces one per data centre — a
 * Cloudflare week is dozens — and a widget is a summary, not the calendar.
 */
const SHOWN = 6;

const endOf = (row: MaintenanceRow) => (row.endsAt === null ? Date.parse(row.startsAt) + 60 * MINUTE : Date.parse(row.endsAt));

/**
 * Scheduled maintenance coming up across the slice. At full width the windows
 * sit on a two-week lane with "now" on it, so "is it tonight or next week?" is
 * read off the position rather than computed from a date.
 */
export function Maintenances({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE);
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useMaintenances({ includeUpcoming: true });
  const title = t("dashboard.widget.maintenances.title");
  const horizon = now + HORIZON_DAYS * DAY;

  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = data.maintenances
    .filter((row) => slice.ids.has(row.providerId) && endOf(row) > now && Date.parse(row.startsAt) < horizon)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const live = (row: MaintenanceRow) => Date.parse(row.startsAt) <= now && endOf(row) > now;
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
  const hours = (row: MaintenanceRow) =>
    `${time.format(new Date(row.startsAt))}${row.endsAt === null ? "" : `–${time.format(new Date(row.endsAt))}`}`;
  const span = (row: MaintenanceRow) => `${day.format(new Date(row.startsAt))} · ${hours(row)}`;
  const until = (iso: string) => formatDuration(i18n.language, (Date.parse(iso) - now) / MINUTE);
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${t("widget.maintenances.meta", { days: HORIZON_DAYS })}`;

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.maintenances.none", { days: HORIZON_DAYS })}</p>
      </WidgetCard>
    );
  }

  const next = rows.find((row) => !live(row)) ?? rows[0]!;
  const shown = rows.slice(0, SHOWN);
  const hidden = rows.length - shown.length;
  const more = hidden > 0 && (
    <p className="font-mono text-xs text-muted-foreground">{t("widget.maintenances.hidden", { count: hidden, days: HORIZON_DAYS })}</p>
  );
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const axisStart = startOfToday.getTime();
  const axisSpan = (HORIZON_DAYS + 1) * DAY;
  const at = (ms: number) => `${Math.max(0, Math.min(100, ((ms - axisStart) / axisSpan) * 100))}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => axisStart + i * ((HORIZON_DAYS + 1) / 4) * DAY);

  return (
    <WidgetCard title={title} meta={meta} className="@container">
      {/* A third: the next one, counting down. */}
      <div className="flex flex-col gap-1.5 @md:hidden">
        <span className="text-[0.95rem] font-medium">{name(next.providerId)} · {next.name}</span>
        <span className="font-mono text-2xl">
          {live(next) ? t("widget.maintenances.live") : t("widget.maintenances.in", { time: until(next.startsAt) })}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {span(next)}
          {rows.length > 1 && ` · ${t("widget.maintenances.more", { count: rows.length - 1 })}`}
        </span>
      </div>

      {/* Half: a list. */}
      <ul className="hidden flex-col @md:flex @2xl:hidden">
        {shown.map((row, index) => (
          <li
            key={`${row.providerId}/${row.id}`}
            className="anim-rise anim-rise-row flex items-center gap-3 border-t border-border py-2.5 text-sm"
            style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
          >
            {live(row) ? (
              <span className="widget-now rounded bg-primary/15 px-1.5 font-mono text-[0.68rem] tracking-wider text-primary uppercase">
                {t("widget.maintenances.live-tag")}
              </span>
            ) : (
              <span className="w-24 shrink-0 font-mono text-xs">{day.format(new Date(row.startsAt))}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{name(row.providerId)} · {row.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {live(row) && row.endsAt !== null ? t("widget.maintenances.until", { time: time.format(new Date(row.endsAt)) }) : hours(row)}
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden @md:block @2xl:hidden">{more}</div>

      {/* Full: the lane. */}
      <div className="hidden @2xl:block">
        <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
          <span />
          <div className="relative h-4 font-mono text-[0.68rem] text-muted-foreground">
            {ticks.map((tick, index) => (
              <span
                key={tick}
                className={cn("absolute top-0 whitespace-nowrap", index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
                style={{ left: at(tick) }}
              >
                {index === 0 ? t("widget.maintenances.today") : day.format(new Date(tick))}
              </span>
            ))}
          </div>
          {shown.map((row, index) => (
            <div key={`${row.providerId}/${row.id}`} className="contents">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{name(row.providerId)} · {row.name}</span>
                <span className={cn("font-mono text-xs", live(row) ? "text-primary" : "text-muted-foreground")}>
                  {live(row)
                    ? t("widget.maintenances.ends-in", { time: until(new Date(endOf(row)).toISOString()) })
                    : `${span(row)} · ${t("widget.maintenances.in", { time: until(row.startsAt) })}`}
                </span>
              </div>
              <div className="relative h-6 rounded-md bg-muted" role="img" aria-label={`${name(row.providerId)}: ${span(row)}`}>
                <span
                  className={cn(
                    "anim-fill absolute inset-y-1 origin-left rounded border border-primary bg-primary/35",
                    live(row) && "widget-now",
                  )}
                  style={{
                    left: at(Date.parse(row.startsAt)),
                    width: `max(0.5rem, calc(${at(endOf(row))} - ${at(Date.parse(row.startsAt))}))`,
                    animationDelay: stagger(index, { base: 200, step: 60 }),
                  }}
                />
                <span aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-foreground/80" style={{ left: at(now) }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">{more}</div>
      </div>
    </WidgetCard>
  );
}
