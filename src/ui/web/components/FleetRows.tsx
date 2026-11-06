import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import { formatPercent, hostOf } from "@/lib/format.ts";
import { pulseAttr, usePulses } from "@/lib/statusPulse.ts";
import { shownStatus } from "@/lib/suspicion.ts";
import { SuspicionTooltip } from "@/components/SuspicionTooltip.tsx";
import type { HistoryBucket, ProviderStatus } from "@/lib/types.ts";

/**
 * One provider as a row: dot, name and host, its 90-day bar row, the 90-day
 * figure, the status word.
 *
 * Shared by the Overview's flat list and by the dense shape's groups, so one
 * provider reads the same wherever it appears rather than as two rows that
 * drifted apart. The status column is 128px: the longest status word, Italian's
 * "Interruzione parziale", fits it in sentence case at 14px.
 */
export function ProviderRow({
  provider, buckets, delay,
}: {
  provider: ProviderStatus;
  buckets: HistoryBucket[];
  delay?: string;
}) {
  const { t, i18n } = useTranslation();
  const shown = shownStatus(provider);
  // Roadmap 4.27: the one-off ring on a row whose status just moved.
  const pulses = usePulses();

  // The calm redesign's row (dashboard-design-direction): the status is a
  // word in sentence case, not mono capitals, and an operational provider's
  // word is muted — colour is for the rows that need a look.
  const tone = (status: typeof shown.status) =>
    status === "operational" ? "var(--muted-foreground)" : statusColor(status);
  return (
    /* Two lines on a phone, one from `lg` up: name and status, then the bar
       row on its own full-width line under the pair that labels it. */
    <div
      {...pulseAttr(pulses, provider.id)}
      className="overview-row anim-rise grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 lg:grid-cols-[minmax(0,200px)_1fr_auto_minmax(0,128px)] lg:gap-6"
      style={delay === undefined ? undefined : { animationDelay: delay }}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
        <SuspicionTooltip suspicion={shown.suspicion}>
          <StatusDot status={shown.status} size={10} hatched={shown.hatched} />
        </SuspicionTooltip>
        <span className="flex min-w-0 flex-col">
          <span className="provider-name truncate text-sm font-medium">{provider.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{hostOf(provider.baseUrl)}</span>
        </span>
      </div>
      <div className="col-span-2 col-start-1 row-start-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        <UptimeBarRow buckets={buckets} scale="compact" />
      </div>
      <span className="hidden text-right font-mono text-sm text-muted-foreground tabular-nums lg:col-start-3 lg:row-start-1 lg:block">
        {formatPercent(i18n.language, provider.uptime90)}
      </span>
      {shown.hatched ? (
        // Roadmap 1.3: both words, the page's first, so the row never claims
        // the provider said something it did not.
        <span className="col-start-2 row-start-1 flex flex-wrap justify-end gap-x-1.5 text-right text-sm font-medium lg:col-start-4">
          <span className="text-muted-foreground">{t(statusLabelKey(provider.overallStatus))}</span>
          <span style={{ color: tone(shown.status) }}>
            · {t("suspected.short", { status: t(statusLabelKey(shown.status)).toLowerCase() })}
          </span>
        </span>
      ) : (
        <span
          className="col-start-2 row-start-1 text-right text-sm font-medium lg:col-start-4"
          style={{ color: tone(shown.status) }}
        >
          {t(statusLabelKey(shown.status))}
        </span>
      )}
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
    <div className="overview-list flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
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
