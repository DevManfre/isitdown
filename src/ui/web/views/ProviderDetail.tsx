import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { IncidentMap } from "@/components/IncidentMap.tsx";
import { ProviderDetailPanel } from "@/components/ProviderDetailPanel.tsx";
import { SlaBudgetCard } from "@/components/SlaBudgetCard.tsx";
import { TrustCard } from "@/components/TrustCard.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useIncidents, useStatus } from "@/hooks/queries.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { formatDateTime, hostOf } from "@/lib/format.ts";
import { impactKey } from "@/lib/incidents.ts";
import { stagger } from "@/lib/stagger.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** The window the page opens on, matching the History view's own default. */
const WINDOW_DAYS = 90;

/** How many of a provider's incidents the page lists before linking on. */
const INCIDENTS_SHOWN = 10;

/**
 * One provider, on a page of its own — roadmap 5.6.
 *
 * The drawer answers the same question in one click from a list, and keeps
 * doing that; what it cannot be is a link. "The GitHub page" is the thing an
 * operator wants to send to somebody, keep in a tab through an incident, or
 * come back to after a restart, and a Sheet that only exists while a list is
 * open is none of those.
 *
 * The uptime, the bars, the calendar and the components are
 * `ProviderDetailPanel`, shared with the drawer rather than rebuilt here: two
 * copies of those blocks is how one of the surfaces ends up a version behind
 * the other. What this page adds is what a drawer had no room for — the
 * provider's own incident history, and where it is answering from.
 */
export function ProviderDetail() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const providerId = params["providerId"] ?? "";
  const { data: status } = useStatus();
  const { data: incidents } = useIncidents({ provider: providerId, pageSize: INCIDENTS_SHOWN });

  const provider = (status?.providers ?? []).find((entry) => entry.id === providerId);

  // The status query is the page's own data, so it throws on an initial-load
  // failure and never lands here undefined. An id nothing knows does, and says
  // so rather than rendering a page about nothing.
  if (status === undefined) return null;
  if (provider === undefined) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">
          {t("provider.unknown", { provider: providerId })}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={ROUTE_PATHS.providers}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("provider.back")}
          </Link>
        </Button>
      </div>
    );
  }

  const rows = incidents?.page.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusDot status={provider.overallStatus} label={t(statusLabelKey(provider.overallStatus))} />
          <h1 className="text-xl font-semibold">{provider.name}</h1>
          {provider.mutedUntil !== undefined && provider.mutedUntil !== null && (
            <Badge variant="muted">{t("provider.muted")}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href={provider.baseUrl} target="_blank" rel="noreferrer">
              {hostOf(provider.baseUrl)}
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTE_PATHS.providers}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("provider.back")}
            </Link>
          </Button>
        </div>
      </div>

      <section aria-label={t("history.list")} className="flex flex-col gap-2">
        <ProviderDetailPanel
          providerId={providerId}
          components={provider.components}
          selection={provider.components.map((component) => ({ id: component.id, name: component.name }))}
          historyWindow={{ days: WINDOW_DAYS }}
          upcoming={provider.maintenance?.upcoming ?? []}
        />
      </section>

      {/* Roadmap 4.13. Under the uptime it is measured from and above the
          incidents that spent it, which is the order the question is asked in.
          Renders nothing at all for a provider with no target. */}
      <SlaBudgetCard providerId={providerId} />
      <TrustCard providerId={providerId} />

      <section aria-label={t("incidents.list")} className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-widest text-primary">{t("incidents.list")}</span>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("incidents.empty-list")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((incident, index) => (
              <li key={`${incident.providerId}/${incident.incidentId}`} style={{ animationDelay: stagger(index) }}>
                <Link
                  className="flex flex-wrap items-baseline gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
                  to={ROUTE_PATHS.incidentDetail
                    .replace(":providerId", incident.providerId)
                    .replace(":incidentId", incident.incidentId)}
                >
                  <span className="font-medium">{incident.name}</span>
                  <Badge variant="muted">{t(impactKey(incident.impact))}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDateTime(i18n.language, incident.startedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Where the provider is answering from — the one block the drawer never
          had room for. Same tile the incident page uses, so the map is drawn
          once in this codebase rather than twice. */}
      <IncidentMap
        providerId={provider.id}
        providerName={provider.name}
        delay={stagger(0)}
        className="w-full"
      />
    </div>
  );
}
