import { useTranslation } from "react-i18next";
import { statusFill } from "@/lib/chartConfig.ts";

/**
 * Incidents by weekday and hour — roadmap 12.3.
 *
 * A grid of divs rather than a chart library: 168 cells with no axis, no
 * tooltip component and no scale is exactly the case `UptimeStrip` already
 * argued Recharts is the wrong tool for. The colour is one status fill at
 * varying opacity, so the grid sits inside the palette every other chart uses
 * instead of introducing a sequential scale of its own.
 *
 * Counted by when an incident *started*. "When do they break" is a question
 * about onset; counting every hour an outage spanned would let one long weekend
 * outage colour a whole row and say nothing.
 */
export function IncidentHeatmap({ grid }: { grid: number[][] }) {
  const { t, i18n } = useTranslation();
  const total = grid.flat().reduce((sum, value) => sum + value, 0);
  const busiest = Math.max(1, ...grid.flat());

  // Monday first, in the operator's own language: the server counts on the same
  // convention, so index 0 is Monday here too.
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(
      // 2026-06-01 is a Monday, so adding the index walks the week in order.
      new Date(Date.UTC(2026, 5, 1 + index)),
    ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-primary">
          {t("heatmap.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("heatmap.hint")}
        </span>
      </div>

      {total === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("heatmap.empty")}
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          {grid.map((row, weekday) => (
            <div key={weekdays[weekday]} className="flex items-center gap-2">
              <span className="w-10 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
                {weekdays[weekday]}
              </span>
              <div className="flex flex-1 gap-px">
                {row.map((count, hour) => (
                  <span
                    key={hour}
                    // The count as a data attribute, the way StatusDot carries
                    // its status: it is what a test reads and what the cell
                    // means, rather than an opacity a restyle could change.
                    data-count={count}
                    title={t("heatmap.cell", {
                      weekday: weekdays[weekday],
                      hour: `${String(hour).padStart(2, "0")}:00`,
                      count,
                    })}
                    className="h-4 min-w-px flex-1 rounded-[1px]"
                    style={{
                      background: statusFill("major_outage"),
                      // Never fully transparent on a cell with incidents, so one
                      // incident in a busy window is still visible.
                      opacity:
                        count === 0 ? 0.06 : 0.25 + 0.75 * (count / busiest),
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
