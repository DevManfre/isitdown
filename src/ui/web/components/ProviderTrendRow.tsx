import { Trans, useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { DeltaChip } from "@/components/DeltaChip.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { TrendSparkline } from "@/components/charts/TrendSparkline.tsx";
import { uptimeForRange } from "@/lib/history.ts";
import type { ProviderHistory } from "@/lib/types.ts";

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
      className="history-row anim-rise col-span-full grid grid-cols-subgrid items-center rounded-md px-2 py-2 text-left hover:bg-muted/40"
      style={{ animationDelay: delay }}
    >
      <span className="flex items-center gap-2 text-sm">
        <StatusDot status={status} />
        <span className="provider-name break-words">{name}</span>
      </span>
      <TrendSparkline series={provider.dailySeries} />
      <span className="font-mono text-sm">
        <NumberTicker locale={i18n.language} value={uptime} decimalPlaces={2} suffix="%" />
      </span>
      {/* The chip is wrapped rather than dropped in bare: `DeltaChip` renders
          nothing at all for a provider with no previous window, and a row that
          emits no element for a track loses the track — its incidents cell
          slides left into the delta column and the header stops matching. An
          empty span holds the column open. */}
      <span>
        <DeltaChip current={uptime} previous={provider.previousUptime} days={days} compact />
      </span>
      <span className="font-mono text-xs text-muted-foreground">
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
