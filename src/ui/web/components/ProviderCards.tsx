import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { SpotlightCard } from "@/components/ui/spotlight-card.tsx";
import { UptimeArc } from "@/components/charts/UptimeArc.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { HistoryBucket, OverallStatus, StaleReading } from "@/lib/types.ts";
import type { ShownStatus } from "@/lib/suspicion.ts";
import { StaleBadge } from "@/components/StaleBadge.tsx";
import { SuspicionTooltip } from "@/components/SuspicionTooltip.tsx";
import { cn } from "@/lib/utils.ts";

export interface ProviderCard {
  id: string;
  name: string;
  host: string;
  adapter: string;
  status: OverallStatus;
  uptime: number;
  incidents: number;
  buckets: HistoryBucket[];
  muted: boolean;
  maintenanceActive: boolean;
  /** Which source is the record for this provider — roadmap 9.1. */
  authority: "declared" | "observed";
  /** Roadmap 1.3. What the card draws; absent reads as the declared status, plainly. */
  shown?: ShownStatus;
  /** Roadmap 1.8. Absent or null when the reading still looks alive. */
  stale?: StaleReading | null;
}

/** The tint and the edge a card takes from its own severity. */
function severityChrome(status: OverallStatus): string {
  if (status === "operational") return "border-border";
  if (status === "degraded" || status === "partial_outage") {
    return "border-status-degraded/40 bg-status-degraded/[0.06]";
  }
  if (status === "major_outage")
    return "border-destructive/40 bg-destructive/[0.06]";
  return "border-border";
}

/**
 * The fleet as cards, above the table that lists the same providers.
 *
 * The table answers "how do these compare" — it sorts, it lines figures up in
 * a column, and it is the right shape for that. It is the wrong shape for "what
 * is wrong right now": every row is the same weight, and severity is a word in
 * the third column. The cards are that second reading, and they are why the
 * table below them no longer has to be both.
 *
 * Cards do not replace the table at any fleet size: past a dozen providers the
 * grid is a wall, and the table is what an operator with fifty providers
 * actually scans. Both are on the page; the grid is capped at the call site.
 */
export function ProviderCards({ providers }: { providers: ProviderCard[] }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="provider-cards grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2">
      {providers.map((provider, index) => {
        const look = provider.shown ?? { status: provider.status, hatched: false, suspicion: null };
        return (
        <SpotlightCard
          key={provider.id}
          data-slot="provider-card"
          {...(look.hatched ? { "data-suspected": true } : {})}
          className={cn(
            "tile-lit anim-rise flex gap-4 rounded-lg border bg-card/70 p-4",
            severityChrome(look.status),
            look.hatched && "border-dashed",
          )}
          style={{
            animationDelay: stagger(index, { base: 60, step: 40, cap: 320 }),
          }}
        >
          <UptimeArc
            value={provider.uptime}
            size={72}
            color={statusColor(look.status)}
            label={t("chart.ring-summary", {
              status: t(statusLabelKey(provider.status)),
              uptime: new Intl.NumberFormat(i18n.language, {
                maximumFractionDigits: 2,
              }).format(provider.uptime),
            })}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{provider.name}</span>
              {provider.maintenanceActive && (
                <Badge variant="muted">{t("provider.maintenance.badge")}</Badge>
              )}
              {provider.muted && (
                <Badge variant="muted">{t("provider.muted.badge")}</Badge>
              )}
              <StaleBadge stale={provider.stale} />
              <SuspicionTooltip suspicion={look.suspicion} className="ml-auto">
                <span
                  className="ml-auto text-xs"
                  style={{ color: statusColor(look.status) }}
                >
                  {look.hatched
                    ? t("suspected.short", { status: t(statusLabelKey(look.status)).toLowerCase() })
                    : t(statusLabelKey(look.status))}
                </span>
              </SuspicionTooltip>
            </div>

            <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className="truncate">{provider.host}</span>
              <span aria-hidden="true">·</span>
              <span>{provider.adapter}</span>
              <span aria-hidden="true">·</span>
              {/* Roadmap 9.1, beside the adapter rather than in a badge of its
                  own: it is the same kind of fact — how this row is read — and
                  the numbers under it mean different things depending on it. */}
              <span
                data-authority={provider.authority}
                title={t("authority.badge", {
                  source: t(`authority.source.${provider.authority}`),
                })}
              >
                {t(`authority.source.${provider.authority}`)}
              </span>
            </span>

            <UptimeStrip buckets={provider.buckets} />

            <div className="flex items-center gap-5">
              <span className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("column.uptime")}
                </span>
                <span className="font-mono text-xs">
                  <NumberTicker
                    locale={i18n.language}
                    value={provider.uptime}
                    decimalPlaces={2}
                    suffix="%"
                  />
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("column.incidents")}
                </span>
                <span className="font-mono text-xs">
                  <NumberTicker
                    locale={i18n.language}
                    value={provider.incidents}
                  />
                </span>
              </span>
            </div>
          </div>
        </SpotlightCard>
        );
      })}
    </div>
  );
}
