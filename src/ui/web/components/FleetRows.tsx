import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { HistoryBucket, ProviderStatus } from "@/lib/types.ts";

/**
 * One provider as a row: dot, name, its 90-day bar row, the status word.
 *
 * Shared by the Overview's flat list and by the dense shape's "needs
 * attention" group, so one provider reads the same wherever it appears rather
 * than as two rows that drifted apart.
 *
 * The status column is 156px wide, not the 110px the flat list hard-coded.
 * The longest status word is Italian's "INTERRUZIONE PARZIALE" — 21 monospace
 * characters at 11.5px, so about 145px — and below that it wraps and takes the
 * whole row to two lines, which costs more vertical space than the 46px it
 * saves horizontally. Measured against the rendered page, not guessed: 132px
 * still wrapped it.
 */
export function ProviderRow({
  provider, buckets, delay,
}: {
  provider: ProviderStatus;
  buckets: HistoryBucket[];
  delay?: string;
}) {
  const { t } = useTranslation();

  return (
    /* Two rows on a phone, one from `md` up. Those three fixed columns left the
       bar row about 20px of a 358px screen — the name and the status word alone
       are 336 of it — so below 768px the bar takes its own full-width line
       under the pair that labels it. */
    <div
      className="overview-row anim-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 lg:grid-cols-[minmax(0,180px)_1fr_minmax(0,156px)] lg:gap-4"
      style={delay === undefined ? undefined : { animationDelay: delay }}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
        <StatusDot status={provider.overallStatus} size={12} />
        <span className="provider-name truncate text-sm">{provider.name}</span>
      </div>
      <div className="col-span-2 col-start-1 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        <UptimeBarRow buckets={buckets} scale="compact" />
      </div>
      <span
        className="col-start-2 row-start-1 font-mono text-right text-[11.5px] lg:col-start-3"
        style={{ color: statusColor(provider.overallStatus) }}
      >
        {t(statusLabelKey(provider.overallStatus)).toUpperCase()}
      </span>
    </div>
  );
}

/**
 * The whole fleet as one flat list — the `compact` and `band` shapes.
 *
 * The cascade starts at 200ms, after the hero and the rule above it. It used
 * to start at 0ms, so the bottom of the page arrived at the same instant as
 * the top and neither read as leading the other.
 */
export const FLEET_ROW_STAGGER = { base: 200, step: 32, cap: 420 } as const;

export function FleetRows({
  providers, buckets,
}: {
  providers: ProviderStatus[];
  buckets: Map<string, HistoryBucket[]>;
}) {
  return (
    <div className="overview-list flex flex-col gap-2">
      {providers.map((provider, index) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          buckets={buckets.get(provider.id) ?? []}
          delay={stagger(index, FLEET_ROW_STAGGER)}
        />
      ))}
    </div>
  );
}
