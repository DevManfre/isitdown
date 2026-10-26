import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { drawOrder, statusTier } from "@/lib/chartConfig.ts";
import { isOffLine, shownStatus } from "@/lib/suspicion.ts";
import { stagger } from "@/lib/stagger.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const providerHref = (id: string) => ROUTE_PATHS.providerDetail.replace(":providerId", id);
const filled = (value: string | null | undefined): value is string => value != null && value.trim() !== "";

/**
 * What breaks on our side, and who answers for it — widget 24. Every provider
 * off the line right now, with the impact and owner the operator wrote on it
 * (roadmap 3.7): the two facts an incident call starts by asking for.
 */
export function WhoToCall({ props }: { props: { filter: FleetFilter } }) {
  const { t } = useTranslation();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const title = t("dashboard.widget.who-to-call.title");
  const prefix = slice.filtered ? `${filterText} · ` : "";
  const described = slice.providers.some((p) => filled(p.impact) || filled(p.owner));
  const rows = slice.providers
    .filter(isOffLine)
    .sort((a, b) => drawOrder(statusTier(shownStatus(b).status)) - drawOrder(statusTier(shownStatus(a).status)));

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={`${prefix}${t("widget.who-to-call.none-meta")}`}>
        <p className="text-sm">{t("widget.who-to-call.calm")}</p>
        {!described && (
          <>
            <p className="text-sm text-muted-foreground">{t("widget.who-to-call.undescribed")}</p>
            <Link to={ROUTE_PATHS.providers} className="text-sm text-primary hover:underline">
              {t("widget.who-to-call.describe")}
            </Link>
          </>
        )}
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title={title}
      meta={`${prefix}${t("widget.who-to-call.meta", { count: rows.length })}`}
      tone="alarm"
      className="@container"
    >
      <ul className="flex flex-col">
        {rows.map((p, index) => (
          <li
            key={p.id}
            className="anim-rise anim-rise-row grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-t border-border py-2.5 text-sm @2xl:grid-cols-[9rem_minmax(0,1fr)_10rem]"
            style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
          >
            <Link to={providerHref(p.id)} className="flex min-w-0 items-center gap-2 rounded-sm font-medium hover:text-primary">
              <StatusDot status={shownStatus(p).status} />
              <span className="truncate">{p.name}</span>
            </Link>
            <span className={filled(p.owner) ? "font-mono text-xs @2xl:order-last" : "font-mono text-xs text-muted-foreground @2xl:order-last"}>
              {filled(p.owner) ? p.owner : t("widget.who-to-call.no-owner")}
            </span>
            <span className={filled(p.impact) ? "col-span-2 @2xl:col-span-1" : "col-span-2 text-muted-foreground @2xl:col-span-1"}>
              {filled(p.impact) ? p.impact : t("widget.who-to-call.no-impact")}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
