import { useTranslation } from "react-i18next";
import { useProviderCalendar } from "@/hooks/queries.ts";
import { statusFill, statusLabelKey } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { CalendarDay } from "@/lib/types.ts";
import type { ProviderPick } from "../../../dashboardLayout.ts";
import { usePicked } from "./shared.ts";
import { LoadFailed, WidgetCard } from "./WidgetCard.tsx";

const COMPACT_WEEKS = 13;
const LEGEND = ["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const;

const troubled = (cell: CalendarDay) => cell.status !== "operational" && cell.status !== "unknown";

/** Days into Monday-first weeks, the first week padded so every row is a weekday. */
function weeks(cells: readonly CalendarDay[]): (CalendarDay | null)[][] {
  if (cells.length === 0) return [];
  const first = new Date(`${cells[0]!.day}T12:00:00Z`).getUTCDay();
  const padded: (CalendarDay | null)[] = [...Array<null>((first + 6) % 7).fill(null), ...cells];
  const out: (CalendarDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7));
  return out;
}

function Grid({ columns, cell, compact }: { columns: (CalendarDay | null)[][]; cell: string; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {columns.map((week, w) => (
        <div
          key={week.find((d) => d !== null)?.day ?? w}
          className="anim-column flex flex-1 flex-col gap-[3px]"
          style={{ ...(compact ? { flex: "0 0 auto" } : {}), animationDelay: stagger(w, { base: 120, step: 9, cap: 600 }) }}
        >
          {week.map((day, d) =>
            day === null ? (
              <span key={`pad-${d}`} style={{ height: cell, width: compact ? cell : undefined }} />
            ) : (
              <span
                key={day.day}
                title={`${day.day} · ${t(statusLabelKey(day.status))}`}
                className="rounded-[3px]"
                style={{
                  height: cell,
                  width: compact ? cell : undefined,
                  background: statusFill(day.status),
                  opacity: day.status === "operational" ? 0.55 : 1,
                }}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A year of one provider, a square a day, coloured by the day's worst — the
 * shape of a provider's record at a glance: a bad month is a smear, a single
 * bad day a dot. Left on its default it follows the fleet's weakest record.
 */
export function YearCalendar({ props }: { props: ProviderPick }) {
  const { t, i18n } = useTranslation();
  const { provider, missing } = usePicked(props.provider);
  const { data, isError, refetch } = useProviderCalendar(provider?.id ?? null);
  const title = t("dashboard.widget.year-calendar.title");
  if (isError) return <LoadFailed title={title} retry={() => void refetch()} />;

  if (missing !== null) {
    return (
      <WidgetCard title={title} className="border-dashed">
        <p className="text-sm text-muted-foreground">{t("widget.provider-tile.missing", { provider: missing })}</p>
      </WidgetCard>
    );
  }
  if (provider === undefined || data === undefined) return <WidgetCard title={title} busy />;

  const cells = data.cells;
  const bad = cells.filter(troubled);
  const byMonth = new Map<string, number>();
  for (const cell of bad) byMonth.set(cell.day.slice(0, 7), (byMonth.get(cell.day.slice(0, 7)) ?? 0) + 1);
  const worstMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const monthName = (ym: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(new Date(`${ym}-15T12:00:00Z`));
  const heading = `${provider.name} · ${t(props.provider === null ? "widget.year-calendar.worst" : "widget.year-calendar.year")}`;

  if (data.measuredDays < 14) {
    return (
      <WidgetCard title={heading}>
        <p className="text-sm text-muted-foreground">{t("widget.year-calendar.young", { count: data.measuredDays })}</p>
      </WidgetCard>
    );
  }

  const conclusion =
    bad.length === 0
      ? t("widget.year-calendar.clean", { count: data.measuredDays })
      : t("widget.year-calendar.summary", {
          count: bad.length,
          days: data.measuredDays,
          month: worstMonth === undefined ? "" : monthName(worstMonth[0]),
          worst: worstMonth?.[1] ?? 0,
        });
  const all = weeks(cells);
  const recent = weeks(cells.slice(-COMPACT_WEEKS * 7));
  const monthTicks = all
    .map((week, index) => ({ index, day: week.find((d) => d !== null)?.day ?? "" }))
    .filter((w, i, list) => i === 0 || w.day.slice(5, 7) !== list[i - 1]!.day.slice(5, 7));

  return (
    <WidgetCard title={heading} meta={t("widget.year-calendar.meta")} conclusion={conclusion} className="@container">
      <ul className="sr-only">
        {bad.map((day) => (
          <li key={day.day}>{t("widget.year-calendar.sr-day", { date: day.day, status: t(statusLabelKey(day.status)) })}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="@md:hidden">
          <Grid columns={recent} cell="0.9rem" compact />
        </div>
        <div className="hidden flex-col gap-1.5 @md:flex">
          <div className="relative h-3.5 font-mono text-[0.65rem] text-muted-foreground" aria-hidden="true">
            {monthTicks.slice(1).map((tick) => (
              <span key={tick.day} className="absolute top-0" style={{ left: `${(tick.index / all.length) * 100}%` }}>
                {new Intl.DateTimeFormat(i18n.language, { month: "short" }).format(new Date(`${tick.day}T12:00:00Z`))}
              </span>
            ))}
          </div>
          <Grid columns={all} cell="0.72rem" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
        {LEGEND.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: statusFill(status), opacity: status === "operational" ? 0.55 : 1 }} />
            {t(statusLabelKey(status))}
          </span>
        ))}
      </div>
    </WidgetCard>
  );
}
