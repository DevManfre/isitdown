import { useTranslation } from "react-i18next";
import { useReliability } from "@/hooks/queries.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { stagger } from "@/lib/stagger.ts";
import { Fill, WidgetCard } from "./WidgetCard.tsx";

/** Below this many incidents a busiest hour is noise, not a habit. */
const FLOOR = 10;
const SPAN = 3;

/** The three-hour window in which the most incidents began. */
function peak(grid: number[][]) {
  let best = { day: 0, hour: 0, count: -1 };
  grid.forEach((row, day) => {
    for (let hour = 0; hour <= 24 - SPAN; hour++) {
      const count = row.slice(hour, hour + SPAN).reduce((a, b) => a + b, 0);
      if (count > best.count) best = { day, hour, count };
    }
  });
  return best;
}

/**
 * When incidents begin, by weekday and hour in the operator's zone, over the
 * last ninety days. The sentence on top is the finding — "Tuesday afternoons"
 * — and the grid is the evidence for it.
 */
export function WeekdayHours() {
  const { t, i18n } = useTranslation();
  const { data } = useReliability(OVERVIEW_WINDOW_DAYS);
  const title = t("dashboard.widget.weekday-hours.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const grid = data.byWeekdayHour;
  const total = grid.flat().reduce((a, b) => a + b, 0);
  const meta = t("widget.weekday-hours.meta", { days: data.days, count: total });
  if (total < FLOOR) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.weekday-hours.few", { count: total, floor: FLOOR })}</p>
      </WidgetCard>
    );
  }

  const weekday = (index: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(Date.UTC(2026, 5, 1 + index)));
  const weekdayLong = (index: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(new Date(Date.UTC(2026, 5, 1 + index)));
  const best = peak(grid);
  const busiest = Math.max(...grid.flat());
  const perDay = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const topDay = Math.max(...perDay);
  const conclusion = t("widget.weekday-hours.peak", {
    count: best.count,
    total,
    day: weekdayLong(best.day),
    from: best.hour,
    to: best.hour + SPAN,
  });

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      {/* A third: the finding alone. */}
      <div className="flex flex-col gap-1 @md:hidden">
        <span className="font-mono text-2xl">
          {weekday(best.day)} {best.hour}–{best.hour + SPAN}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{t("widget.weekday-hours.share", { count: best.count, total })}</span>
      </div>

      {/* Half: one bar per weekday. */}
      <ul className="hidden flex-col gap-1.5 @md:flex @2xl:hidden" aria-hidden="true">
        {perDay.map((count, day) => (
          <li key={day} className="flex items-center gap-3">
            <span className="w-9 font-mono text-xs text-muted-foreground">{weekday(day)}</span>
            <Fill value={topDay === 0 ? 0 : count / topDay} color="var(--color-accent)" className="h-2.5 flex-1" delay={stagger(day, { base: 160, step: 50 })} />
            <span className="w-6 text-right font-mono text-xs">{count}</span>
          </li>
        ))}
      </ul>

      {/* Full: the 7 × 24 grid. */}
      <ul className="sr-only">
        {grid.map((row, day) => {
          const top = Math.max(...row);
          return (
            <li key={day}>
              {t("widget.weekday-hours.sr-day", { day: weekdayLong(day), count: perDay[day], hour: row.indexOf(top), at: top })}
            </li>
          );
        })}
      </ul>
      <div className="hidden @2xl:block" aria-hidden="true">
        <div className="flex flex-col gap-[3px]">
          <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[3px]">
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="text-center font-mono text-[0.6rem] text-muted-foreground">
                {hour % 3 === 0 ? hour : ""}
              </span>
            ))}
          </div>
          {grid.map((row, day) => (
            <div key={day} className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] items-center gap-[3px]">
              <span className="font-mono text-xs text-muted-foreground">{weekday(day)}</span>
              <div
                className="anim-row-sweep col-span-24 grid grid-cols-subgrid"
                style={{ animationDelay: stagger(day, { base: 140, step: 55 }) }}
              >
                {row.map((count, hour) => (
                  <span
                    key={hour}
                    className="h-5 rounded-[3px]"
                    style={{
                      background:
                        count === 0
                          ? "var(--muted)"
                          : `color-mix(in srgb, var(--color-accent) ${Math.round(25 + (count / busiest) * 75)}%, var(--muted))`,
                      boxShadow:
                        day === best.day && hour >= best.hour && hour < best.hour + SPAN ? "inset 0 0 0 1.5px var(--foreground)" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
          0
          <span aria-hidden="true" className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg, var(--muted), var(--color-accent))" }} />
          {busiest}
        </div>
      </div>
    </WidgetCard>
  );
}
