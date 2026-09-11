import { useTranslation } from "react-i18next";
import { calendarGrid, WEEKDAYS } from "@/lib/calendarGrid.ts";
import { statusFill, statusLabelKey, statusMuted } from "@/lib/chartConfig.ts";
import { formatDay } from "@/lib/format.ts";
import type { CalendarDay } from "@/lib/types.ts";

/**
 * A year of day cells, one column per week — roadmap 5.20.
 *
 * Retention has been allowed to run to 3650 days since roadmap 4.5, while the
 * widest view stayed a 90-day bar row: every sample past that was stored and
 * never shown. This is that data, on the only shape that fits a year in a
 * drawer's width — a cell per day, coloured by the day's worst status, the same
 * five colours the bar row and the legend beside it already use.
 *
 * Not a Recharts chart: there is no axis, no scale and no series here, just a
 * grid of squares. Wrapping it in `ChartContainer` would buy nothing and cost
 * the tooltip's own animation quirks (see `UptimeBarRow`).
 *
 * Hover carries the day, its status and how much of it was up; the accessible
 * name carries the window's verdict, which is what a screen reader or a
 * keyboard — neither of which reaches 365 hover targets — actually needs.
 */
export function YearHeatCalendar({
  cells,
  uptime,
  measuredDays,
  heading,
}: {
  cells: CalendarDay[];
  uptime: number;
  measuredDays: number;
  heading: string;
}) {
  const { t, i18n } = useTranslation();
  const { columns, months } = calendarGrid(cells);

  if (columns.length === 0) return null;

  const monthLabel = (month: string) =>
    new Intl.DateTimeFormat(i18n.language, { month: "short", timeZone: "UTC" }).format(
      new Date(`${month}-01T00:00:00Z`),
    );

  return (
    <div className="year-heat flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{heading}</span>

      <div className="flex flex-col gap-1 overflow-x-auto">
        {/* The month row and the cell grid share a column count, so a label
            sits over the week its month starts in rather than near it. */}
        <div
          aria-hidden="true"
          className="grid gap-[2px] font-mono text-[10px] text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${columns.length}, 10px)` }}
        >
          {months.map((month) => (
            <span key={month.month} className="whitespace-nowrap" style={{ gridColumnStart: month.column + 1 }}>
              {monthLabel(month.month)}
            </span>
          ))}
        </div>

        <div
          className="anim-fade grid grid-flow-col gap-[2px]"
          style={{ gridTemplateRows: `repeat(${WEEKDAYS}, 10px)` }}
          role="img"
          aria-label={t("history.calendar-summary", {
            days: cells.length,
            measured: measuredDays,
            uptime: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(uptime),
          })}
        >
          {columns.flatMap((column, columnIndex) =>
            column.map((cell, rowIndex) =>
              cell === null ? (
                // A slot outside the window, not an unmeasured day: it paints
                // nothing, while an unmeasured day paints `unknown`.
                <span key={`pad-${columnIndex}-${rowIndex}`} aria-hidden="true" />
              ) : (
                <span
                  key={cell.day}
                  data-day={cell.day}
                  data-status={cell.status}
                  className="size-[10px] rounded-[2px]"
                  style={{
                    background: statusFill(cell.status),
                    opacity: statusMuted(cell.status) ? 0.45 : 1,
                  }}
                  title={
                    cell.uptime === null
                      ? `${formatDay(i18n.language, cell.day)} · ${t("history.month-no-data")}`
                      : t("history.calendar-day", {
                          day: formatDay(i18n.language, cell.day),
                          status: t(statusLabelKey(cell.status)),
                          uptime: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(
                            cell.uptime,
                          ),
                        })
                  }
                />
              ),
            ),
          )}
        </div>
      </div>
    </div>
  );
}
