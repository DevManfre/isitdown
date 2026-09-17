import { Trans, useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { DeltaChip } from "@/components/DeltaChip.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { TrendSparkline } from "@/components/charts/TrendSparkline.tsx";
import { uptimeForRange } from "@/lib/history.ts";
import type { ProviderHistory } from "@/lib/types.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";

/**
 * One provider's trend at a glance: current status, name, the shape of its
 * daily uptime, the figure for the active range, its delta, and what it cost.
 *
 * One figure, not three. The 7/30/90 trio this row used to print made five
 * unlabelled monospace numbers of a row whose job is comparison; the other two
 * windows are a click away in the drawer, under their own labels.
 *
 * The row is a button rather than a div with a handler: it is the only way into
 * the detail, so it has to be reachable by keyboard and named for a screen
 * reader.
 */
export function ProviderTrendRow({
  provider, name, status, days, delay, onOpen,
}: {
  provider: ProviderHistory;
  name: string;
  status: string;
  days: number;
  delay: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const uptime = uptimeForRange(provider, days);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("history.open-detail", { name })}
      // `subgrid`, not a grid template of its own: the tracks belong to the
      // list, so every row's figure sits under the header that names it.
      // `subgrid`, not a grid template of its own: the tracks belong to the
      // list, so every row's figure sits under the header that names it. Below
      // `md` the list is a column of cards and there are no shared tracks to
      // sit under, so the row draws its own two-column card instead.
      className="history-row anim-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-md border border-border p-3 text-left hover:bg-muted/40 lg:col-span-full lg:grid-cols-subgrid lg:gap-y-0 lg:border-0 lg:px-2 lg:py-2"
      style={{ animationDelay: delay }}
    >
      <span className="col-start-1 row-start-1 flex items-center gap-2 text-sm">
        <StatusDot status={status} label={t(statusLabelKey(status))} />
        <span className="provider-name break-words">{name}</span>
      </span>
      <span className="col-span-2 col-start-1 row-start-3 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        <TrendSparkline series={provider.dailySeries} />
      </span>
      <span className="col-start-2 row-start-1 text-right font-mono text-sm lg:col-start-3 lg:text-left">
        <NumberTicker locale={i18n.language} value={uptime} decimalPlaces={2} suffix="%" />
      </span>
      {/* The chip is wrapped rather than dropped in bare: `DeltaChip` renders
          nothing at all for a provider with no previous window, and a row that
          emits no element for a track loses the track — its incidents cell
          slides left into the delta column and the header stops matching. An
          empty span holds the column open. */}
      <span className="col-start-1 row-start-2 lg:col-start-4 lg:row-start-1">
        <DeltaChip
          delta={
            provider.previousUptime === null
              ? null
              : Math.round((uptime - provider.previousUptime) * 100) / 100
          }
          days={days}
          compact
        />
      </span>
      <span className="col-start-2 row-start-2 text-right font-mono text-xs text-muted-foreground lg:col-start-5 lg:row-start-1 lg:text-left">
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
      </span>
    </button>
  );
}
