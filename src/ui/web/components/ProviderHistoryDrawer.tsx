import { Trans, useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ComponentRows } from "@/components/ComponentRows.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { StatusLegend } from "@/components/charts/StatusLegend.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { useProviderHistory } from "@/hooks/queries.ts";
import type { ComponentStatus, ProviderHistory } from "@/lib/types.ts";

/**
 * One provider's history in full: the three windows, the daily status bars with
 * their axis and colour key, and the component breakdown.
 *
 * This is where everything the list stopped showing went. The list answers
 * "which provider, and which way is it going"; this answers "what happened",
 * and it costs a click rather than 1400px of always-open component rows.
 *
 * The per-provider request is the reason this is a component and not inline
 * markup: `useProviderHistory(providerId, days)` must mount and unmount with
 * the drawer, so nothing is fetched for a provider nobody opened. That hook
 * also never throws — see its doc comment: this detail failing must not take
 * the page that opened it down with it.
 */
export function ProviderHistoryDrawer({
  providerId, name, status, components, selection, days, onClose,
}: {
  providerId: string | null;
  name: string;
  status: string;
  components: ComponentStatus[];
  selection: { id: string; name: string }[];
  days: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useProviderHistory(providerId, days);
  const provider = data !== undefined && "providerId" in data ? (data as ProviderHistory) : undefined;

  return (
    <Sheet open={providerId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* No background override here, deliberately: `SheetContent` paints
          `bg-background`, and the daily bars draw an unsampled day in
          `--status-unknown`, which reads on that token and disappears on
          `--card`. Painting this on the surface token loses the whole
          unmeasured stretch of every bar row — do not "tidy" it to `bg-card`. */}
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <StatusDot status={status} />
            {name}
          </SheetTitle>
        </SheetHeader>

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

            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-widest text-primary">
                {t("history.drawer-window", { days })}
              </span>
              <UptimeBarRow buckets={provider.buckets} scale="row" showAxis />
              {/* One legend, below both bar rows' worth of colour: the component
                  strips underneath use the same five statuses. */}
              <StatusLegend />
            </div>

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
      </SheetContent>
    </Sheet>
  );
}
