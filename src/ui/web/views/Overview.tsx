import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeBarRow } from "@/components/charts/UptimeBarRow.tsx";
import { UptimeRing } from "@/components/charts/UptimeRing.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatPercent, formatRelative } from "@/lib/format.ts";
import { summaryProviders } from "@/lib/history.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

const WINDOW_DAYS = 90;

/**
 * Design 3a's Overview: the gradient hero with the headline and two calls to
 * action, a grid of provider rings, then one uptime bar row per provider.
 * Straight port of src/ui/public/js/views/overview.js.
 */
export function Overview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: status } = useStatus();
  const { data: summary } = useHistory(WINDOW_DAYS);

  const providers = status?.providers ?? [];
  const buckets = new Map(summaryProviders(summary).map((p) => [p.providerId, p.buckets]));

  // The headline is chosen by plural rule, never assembled from fragments —
  // "one provider is off the line" and "3 providers are off the line" are
  // separate catalog entries, selected by i18next's count-based plural rule.
  const down = providers.filter((p) => p.overallStatus !== "operational");
  const lastSeen = providers
    .map((p) => p.fetchedAt)
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1);
  const withIncident = providers.find((p) => p.activeIncidents.length > 0);
  const average =
    providers.length === 0
      ? 0
      : Math.round((providers.reduce((sum, p) => sum + p.uptime90, 0) / providers.length) * 100) / 100;

  return (
    <>
      {/* The standard view padding is dropped here (there is no `.view` class
          left to remove — the whole layer moved to Tailwind), so the hero's
          own radial glow can bleed to the true edges of #view instead of
          stopping at the console's usual 32px gutter, then restore the same
          inset for its own content. */}
      <div
        className="view-hero -mx-8 -mt-6 grid grid-cols-1 gap-8 px-8 pt-6 pb-6 md:grid-cols-2"
        style={{ background: "radial-gradient(110% 70% at 8% 0%, var(--color-accent-900), transparent 60%)" }}
      >
        <div className="hero-copy flex flex-col gap-3">
          <span className="anim-rise text-xs uppercase tracking-widest text-primary">
            {t("overview.kicker")}
          </span>
          <h2 className="anim-rise anim-rise-hero text-3xl font-medium" style={{ animationDelay: "60ms" }}>
            {down.length === 0
              ? t("overview.title.all-operational")
              : t("overview.title.down", { count: down.length })}
          </h2>
          <p className="anim-rise anim-rise-hero text-muted-foreground" style={{ animationDelay: "130ms" }}>
            {down.length === 0
              ? t("overview.body.all-operational", {
                  count: providers.length,
                  since: lastSeen === undefined ? t("meta.never-polled") : formatRelative(i18n.language, lastSeen),
                })
              : t("overview.body.down", { providers: down.map((p) => p.name).join(", ") })}
          </p>
          <div className="anim-rise anim-rise-hero flex gap-2" style={{ animationDelay: "200ms" }}>
            {withIncident !== undefined && (
              <Button
                type="button"
                onClick={() =>
                  navigate(`/incidents/${withIncident.id}/${withIncident.activeIncidents[0]?.id ?? ""}`)
                }
              >
                {t("action.incident-details")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => navigate(ROUTE_PATHS.history)}>
              {t("action.history-90d")}
            </Button>
          </div>
        </div>

        <div className="ring-grid grid grid-cols-2 gap-4">
          {providers.map((provider, index) => (
            // Rings follow the hero, 80ms apart, after a 120ms lead-in.
            <UptimeRing key={provider.id} provider={provider} delay={`${120 + index * 80}ms`} />
          ))}
        </div>
      </div>

      <div className="overview-rows flex flex-col gap-4">
        {/* The rule sweeps in under the hero, before the rows arrive. */}
        <div className="fade-rule anim-sweep h-px bg-border" style={{ animationDelay: "220ms" }} />

        {providers.length === 0 ? (
          <p className="text-muted-foreground">{t("providers.empty")}</p>
        ) : (
          <>
            <div className="overview-list flex flex-col gap-2">
              {providers.map((provider, index) => (
                <div
                  key={provider.id}
                  className="overview-row anim-rise grid grid-cols-[minmax(0,180px)_1fr_minmax(0,110px)] items-center gap-4"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <StatusDot status={provider.overallStatus} size={12} />
                    <span className="provider-name text-sm">{provider.name}</span>
                  </div>
                  <UptimeBarRow buckets={buckets.get(provider.id) ?? []} scale="compact" />
                  <span
                    className="font-mono text-right text-[11.5px]"
                    style={{ color: statusColor(provider.overallStatus) }}
                  >
                    {t(statusLabelKey(provider.overallStatus)).toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="anim-fade text-sm text-muted-foreground"
              style={{ animationDelay: `${providers.length * 70}ms` }}
            >
              {t("overview.uptime-window", { uptime: formatPercent(i18n.language, average) })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
