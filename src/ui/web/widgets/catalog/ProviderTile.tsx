import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useHistory, useIncidents, useReliability } from "@/hooks/queries.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { formatDuration, formatRelative } from "@/lib/format.ts";
import { statusColor, statusFill, statusLabelKey, suspectedHatchCss } from "@/lib/chartConfig.ts";
import { summaryProviders } from "@/lib/history.ts";
import { stagger } from "@/lib/stagger.ts";
import { shownStatus } from "@/lib/suspicion.ts";
import { incidentStatusKey } from "@/lib/incidents.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { ProviderPick } from "../../../dashboardLayout.ts";
import { usePicked } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const DAYS_SHOWN = 30;

/**
 * One provider, large — the one a team depends on most, or (left on its
 * default) whichever is worst right now. The edge and the status word cross
 * over in colour when a refresh changes them, so a tile turning red is seen
 * turning, not just found red.
 */
export function ProviderTile({ props }: { props: ProviderPick }) {
  const { t, i18n } = useTranslation();
  const { provider, missing } = usePicked(props.provider);
  const { data: summary } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  const { data: reliability } = useReliability(OVERVIEW_WINDOW_DAYS);
  const { data: incidents } = useIncidents({ state: "active", pageSize: 1 });
  const title = t("dashboard.widget.provider-tile.title");

  if (missing !== null) {
    return (
      <WidgetCard title={title} className="border-dashed">
        <p className="text-sm text-muted-foreground">{t("widget.provider-tile.missing", { provider: missing })}</p>
      </WidgetCard>
    );
  }
  if (provider === undefined) return <WidgetCard title={title} busy />;

  const shown = shownStatus(provider);
  const history = summaryProviders(summary).find((p) => p.providerId === provider.id);
  const days = (history?.buckets ?? []).slice(-DAYS_SHOWN);
  const mttr = reliability?.providers.find((p) => p.providerId === provider.id)?.mttrMinutes ?? null;
  const incident = (incidents?.active ?? []).find((row) => row.providerId === provider.id);
  const bad = shown.status !== "operational" && shown.status !== "unknown";
  const tone = shown.status === "major_outage" || shown.status === "partial_outage" ? "alarm" : bad ? "warn" : undefined;
  const statusWord = t(statusLabelKey(shown.status));

  return (
    <WidgetCard
      title={props.provider === null ? t("widget.provider-tile.worst") : title}
      tone={tone}
      className="widget-tone @container"
      style={bad ? { backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${statusColor(shown.status)} 10%, transparent), transparent 45%)` } : undefined}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <ProviderIcon name={provider.name} baseUrl={provider.baseUrl} size={36} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-lg font-medium @md:text-xl">{provider.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {provider.fetchedAt === null ? t("meta.never-polled") : t("widget.provider-tile.read", { since: formatRelative(i18n.language, provider.fetchedAt) })}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <StatusDot status={shown.status} hatched={shown.hatched} pulse={bad} />
          <span
            className="widget-tone font-mono text-xs tracking-wider uppercase"
            style={{ color: statusColor(shown.status) }}
          >
            {shown.hatched ? t("widget.provider-tile.suspected", { status: statusWord }) : statusWord}
          </span>
        </span>
      </div>

      {shown.hatched && shown.suspicion !== null && (
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: suspectedHatchCss(shown.suspicion.status) }} />
          {t("widget.provider-tile.suspicion", { since: formatRelative(i18n.language, shown.suspicion.since) })}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="flex flex-col">
          <NumberTicker className="font-mono text-2xl" locale={i18n.language} value={provider.uptime90} decimalPlaces={2} suffix="%" />
          <span className="font-mono text-xs text-muted-foreground">{t("widget.provider-tile.uptime")}</span>
        </div>
        <div className="hidden flex-col @md:flex">
          {summary === undefined ? (
            <span className="font-mono text-2xl">…</span>
          ) : (
            <NumberTicker className="font-mono text-2xl" locale={i18n.language} value={history?.incidentCount ?? 0} />
          )}
          <span className="font-mono text-xs text-muted-foreground">{t("widget.provider-tile.incidents")}</span>
        </div>
        <div className="hidden flex-col @md:flex">
          <span className="font-mono text-2xl">{reliability === undefined ? "…" : mttr === null ? "—" : formatDuration(i18n.language, mttr)}</span>
          <span className="font-mono text-xs text-muted-foreground">{t("widget.provider-tile.mttr")}</span>
        </div>
        {days.length > 0 && (
          <div className="hidden min-w-48 flex-1 flex-col gap-1.5 @2xl:flex">
            <span className="font-mono text-xs text-muted-foreground">{t("widget.provider-tile.days", { count: days.length })}</span>
            <div className="flex h-6 gap-0.5" aria-hidden="true">
              {days.map((day, index) => (
                <span
                  key={day.day}
                  className="anim-bar flex-1 origin-bottom rounded-sm"
                  style={{ background: statusFill(day.status), animationDelay: stagger(index, { base: 160, step: 12, cap: 520 }) }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {incident !== undefined && (
        <div className="flex min-w-0 items-center gap-3 border-t border-border pt-3 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {incident.name}
            <span className="font-mono text-xs text-muted-foreground"> · {t(incidentStatusKey(incident.status))}</span>
          </span>
          <Link
            className="shrink-0 text-primary hover:underline"
            to={ROUTE_PATHS.incidentDetail.replace(":providerId", incident.providerId).replace(":incidentId", incident.incidentId)}
          >
            {t("action.incident-details")}
          </Link>
        </div>
      )}
    </WidgetCard>
  );
}
