import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { drawOrder, statusColor, statusLabelKey, statusTier } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { ComponentStatus, ProviderStatus } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const providerHref = (id: string) => ROUTE_PATHS.providerDetail.replace(":providerId", id);

/**
 * The broken pieces of every provider in one list — widget 19. A provider can
 * read "operational" with one of its components down; this is where that
 * component shows up anyway, worst first, with the provider's own word beside it.
 */
export function DegradedComponents({ props }: { props: { filter: FleetFilter } }) {
  const { t } = useTranslation();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const title = t("dashboard.widget.degraded-components.title");
  const all = slice.providers.flatMap((p) => p.components.map((c) => ({ provider: p, component: c })));
  const rows = all
    .filter(({ component }) => component.status !== "operational" && component.status !== "unknown")
    .sort(
      (a, b) =>
        drawOrder(statusTier(b.component.status)) - drawOrder(statusTier(a.component.status)) ||
        a.provider.name.localeCompare(b.provider.name),
    );
  const prefix = slice.filtered ? `${filterText} · ` : "";

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={`${prefix}${t("widget.degraded-components.none-meta")}`}>
        <div className="flex items-start gap-3 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--status-operational)]" />
          <span>{t("widget.degraded-components.none", { count: all.length })}</span>
        </div>
      </WidgetCard>
    );
  }

  const providers = new Set(rows.map((r) => r.provider.id)).size;
  const first = rows[0]!;
  const selected = (p: ProviderStatus, c: ComponentStatus) => p.componentSelection.some((s) => s.id === c.id);

  return (
    <WidgetCard
      title={title}
      meta={`${prefix}${t("widget.degraded-components.meta", { count: rows.length, providers })}`}
      conclusion={t("widget.degraded-components.conclusion")}
      tone="warn"
      className="@container"
    >
      <div className="flex flex-col gap-1 @md:hidden">
        <span className="font-mono text-4xl leading-none">{rows.length}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("widget.degraded-components.of", { total: all.length })}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("widget.degraded-components.worst", { provider: first.provider.name, component: first.component.name })}
        </span>
      </div>

      <ul className="hidden flex-col @md:flex">
        {rows.map(({ provider, component }, index) => (
          <li key={`${provider.id}/${component.id}`} className="border-t border-border">
            <Link
              to={providerHref(provider.id)}
              className="anim-rise anim-rise-row flex min-w-0 items-center gap-2.5 rounded-sm py-2.5 text-sm hover:text-primary"
              style={{ animationDelay: stagger(index, { base: 120, step: 40 }) }}
            >
              <StatusDot status={component.status} />
              <span
                className="hidden w-40 shrink-0 truncate font-mono text-[0.68rem] tracking-wider uppercase @2xl:inline"
                style={{ color: statusColor(component.status) }}
              >
                {t(statusLabelKey(component.status))}
              </span>
              <span className="w-24 shrink-0 truncate text-muted-foreground">{provider.name}</span>
              <span className="min-w-0 truncate">{component.name}</span>
              {provider.overallStatus === "operational" ? (
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {t("widget.degraded-components.provider-fine")}
                </span>
              ) : selected(provider, component) ? (
                <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">
                  {t("widget.degraded-components.selected")}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
