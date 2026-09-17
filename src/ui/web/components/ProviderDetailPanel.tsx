import { Trans, useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ComponentRows } from "@/components/ComponentRows.tsx";
import { StatusLegend } from "@/components/charts/StatusLegend.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { YearHeatCalendar } from "@/components/charts/YearHeatCalendar.tsx";
import { useProviderCalendar, useProviderHistory } from "@/hooks/queries.ts";
import { formatDateTime, formatTime } from "@/lib/format.ts";
import type { ComponentStatus, MaintenanceWindow, ProviderHistory } from "@/lib/types.ts";
import type { HistoryWindow } from "@/lib/api.ts";

/**
 * The soonest-starting window in `upcoming`, or `undefined` when nothing is
 * declared. `upcoming` arrives in the order the server's array holds it in — so
 * this is the one place that imposes a meaning on "next".
 */
function nextOf(upcoming: readonly MaintenanceWindow[]): MaintenanceWindow | undefined {
  if (upcoming.length === 0) return undefined;
  return [...upcoming].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))[0];
}

/**
 * One provider's history in full: the three windows, the daily status bars with
 * an axis and a colour key, the year calendar, and the component breakdown.
 *
 * Extracted from the drawer when the provider page shipped (roadmap 5.6) so the
 * two surfaces cannot drift: the drawer is this panel inside a Sheet, the page
 * is this panel with the incidents and the map beside it. A second copy of
 * these blocks is how one of them ends up a version behind the other.
 *
 * It paints no background of its own, deliberately: the daily bars draw an
 * unsampled day in `--status-unknown`, which reads on `--background` and
 * disappears on `--card`. Whatever surface hosts this panel has to be the
 * plain one — do not "tidy" either caller to `bg-card`.
 */
export function ProviderDetailPanel({
  providerId, components, selection, historyWindow, upcoming,
}: {
  providerId: string | null;
  components: ComponentStatus[];
  selection: { id: string; name: string }[];
  historyWindow: HistoryWindow;
  upcoming: MaintenanceWindow[];
}) {
  const { t, i18n } = useTranslation();
  const { data } = useProviderHistory(providerId, historyWindow);
  const days = historyWindow.days;
  const { data: calendar } = useProviderCalendar(providerId);
  const provider = data !== undefined && "providerId" in data ? (data as ProviderHistory) : undefined;
  const nextMaintenance = nextOf(upcoming);

  return (
    <>
      {provider === undefined ? null : (
        <div className="flex flex-col gap-4 px-4 pb-4">
          <dl className="flex flex-wrap gap-6">
            {([7, 30, 90] as const).map((range) => (
              <div key={range} className="flex flex-col gap-1">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {t("column.range", { days: range })}
                </dt>
                <dd className="font-mono text-sm">
                  <NumberTicker
                    locale={i18n.language}
                    value={range === 7 ? provider.uptime7 : range === 30 ? provider.uptime30 : provider.uptime90}
                    decimalPlaces={2}
                    suffix="%"
                  />
                </dd>
              </div>
            ))}
          </dl>

          {/* Omitted entirely when nothing is upcoming, rather than an empty
              state — an operator with no maintenance declared should see the
              same drawer as before this shipped, not a new empty panel. Not a
              `Card`: every other block here sits directly on the Sheet's own
              surface, and a nested elevation would read as one more thing to
              notice rather than a continuation of the stats above it. */}
          {nextMaintenance !== undefined && (
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-widest text-primary">
                  {t("history.next-maintenance.kicker")}
                </span>
                <Badge variant="muted">{t("history.next-maintenance.badge")}</Badge>
              </div>
              <span className="text-sm">{nextMaintenance.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDateTime(i18n.language, nextMaintenance.startsAt)}
                {nextMaintenance.endsAt !== null && `–${formatTime(i18n.language, nextMaintenance.endsAt)}`}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-primary">
              {t("history.drawer-bars")}
            </span>
            <UptimeBarRow buckets={provider.buckets} scale="row" showAxis />
            {/* One legend, below both bar rows' worth of colour: the component
                strips underneath use the same five statuses. */}
            <StatusLegend />
          </div>

          {/* Roadmap 5.20. Under the bar row and its legend, because it is the
              same five colours over a longer window: retention may run to
              3650 days, and until this shipped nothing showed a sample older
              than ninety. Absent rather than empty while the year is still
              loading, or if that one request failed — the drawer's own
              figures above it are unaffected either way. */}
          {calendar !== undefined && (
            <YearHeatCalendar
              cells={calendar.cells}
              uptime={calendar.uptime}
              measuredDays={calendar.measuredDays}
              heading={t("history.calendar-title")}
            />
          )}

          <p className="font-mono text-xs text-muted-foreground">
            <Trans
              i18nKey="history.incidents"
              count={provider.incidentCount}
              values={{ count: provider.incidentCount }}
              components={[<NumberTicker locale={i18n.language} value={provider.incidentCount} />]}
            />
            {" · "}
            <Trans
              i18nKey="history.downtime"
              values={{ minutes: provider.downtimeMinutes }}
              components={[<NumberTicker locale={i18n.language} value={provider.downtimeMinutes} />]}
            />
          </p>

          {selection.length > 0 && providerId !== null && (
            <ComponentRows
              providerId={providerId}
              days={days}
              current={components}
              heading={t("components.rows-title")}
            />
          )}
        </div>
      )}
    </>
  );
}
