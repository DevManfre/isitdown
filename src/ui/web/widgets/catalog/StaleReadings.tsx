import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { formatRelative } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const providerHref = (id: string) => ROUTE_PATHS.providerDetail.replace(":providerId", id);

/** Why a provider's reading is not fresh, worst first: failing beats unchanged. */
const reasonOf = (p: ProviderStatus): "failing" | "unchanged" | "shrunk" | null =>
  p.failureCount > 0 ? "failing" : (p.stale?.reason ?? null);

/**
 * Readings that stopped — widget 15. A provider whose adapter keeps failing,
 * or whose page has not moved in suspiciously long (roadmap 1.8): the colour on
 * screen for it is old, not good, and nothing else on the Overview says so.
 */
export function StaleReadings({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const title = t("dashboard.widget.stale-readings.title");
  const rows = slice.providers
    .filter((p) => reasonOf(p) !== null)
    .sort((a, b) => b.failureCount - a.failureCount || a.name.localeCompare(b.name));
  const prefix = slice.filtered ? `${filterText} · ` : "";

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={`${prefix}${t("widget.stale-readings.none-meta")}`}>
        <div className="flex items-start gap-3 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--status-operational)]" />
          <span>{t("widget.stale-readings.none", { count: slice.providers.length })}</span>
        </div>
      </WidgetCard>
    );
  }

  const detail = (p: ProviderStatus) => {
    const reason = reasonOf(p);
    if (reason === "failing") return t("widget.stale-readings.failing", { count: p.failureCount });
    if (reason === "shrunk") return t("widget.stale-readings.shrunk");
    return t("widget.stale-readings.unchanged");
  };
  const lastRead = (p: ProviderStatus) =>
    p.fetchedAt === null ? t("meta.never-polled") : t("widget.stale-readings.last-read", { when: formatRelative(i18n.language, p.fetchedAt) });

  return (
    <WidgetCard
      title={title}
      meta={`${prefix}${t("widget.stale-readings.meta", { count: rows.length, total: slice.providers.length })}`}
      conclusion={t("widget.stale-readings.conclusion", { count: rows.length })}
      tone={rows.some((p) => p.failureCount > 0) ? "alarm" : "warn"}
      className="@container"
    >
      <ul className="flex flex-col">
        {rows.map((p, index) => (
          <li key={p.id} className="border-t border-border">
            <Link
              to={providerHref(p.id)}
              className="anim-rise anim-rise-row flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-sm py-2.5 text-sm hover:text-primary"
              style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
            >
              <span
                className="w-36 shrink-0 font-mono text-[0.68rem] tracking-wider uppercase"
                style={{ color: p.failureCount > 0 ? "var(--status-major-outage)" : "var(--status-degraded)" }}
              >
                {detail(p)}
              </span>
              <span className="min-w-0 truncate font-medium">{p.name}</span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{lastRead(p)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
