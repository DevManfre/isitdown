import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { formatRelative } from "@/lib/format.ts";
import { suspectedOf } from "@/lib/suspicion.ts";
import { stagger } from "@/lib/stagger.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const providerHref = (id: string) => ROUTE_PATHS.providerDetail.replace(":providerId", id);

/**
 * The page says one thing, our probe another — widget 14. A provider whose
 * reading is a suspicion (roadmap 1.3) the page has not declared: possibly an
 * outage nobody has admitted yet, which is the one the headline cannot carry.
 */
export function Suspected({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const title = t("dashboard.widget.suspected.title");
  const rows = suspectedOf(slice.providers).sort((a, b) => (a.suspected!.since < b.suspected!.since ? -1 : 1));
  const prefix = slice.filtered ? `${filterText} · ` : "";

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={`${prefix}${t("widget.suspected.none-meta")}`}>
        <div className="flex items-start gap-3 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--status-operational)]" />
          <span>{t("widget.suspected.none", { count: slice.providers.length })}</span>
        </div>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title={title}
      meta={`${prefix}${t("widget.count-providers", { count: rows.length })}`}
      conclusion={t("widget.suspected.conclusion", { count: rows.length })}
      tone="warn"
      className="@container"
    >
      <ul className="flex flex-col">
        {rows.map((p, index) => (
          <li key={p.id} className="border-t border-border">
            <Link
              to={providerHref(p.id)}
              className="anim-rise anim-rise-row flex min-w-0 items-center gap-2.5 rounded-sm py-2.5 text-sm hover:text-primary"
              style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
            >
              <StatusDot status={p.suspected!.status} hatched label={t("widget.suspected.word")} />
              <span className="w-24 shrink-0 truncate font-medium @md:w-28">{p.name}</span>
              <span className="hidden truncate text-muted-foreground @md:inline">
                {t("widget.suspected.versus", {
                  page: t(statusLabelKey(p.overallStatus)),
                  probe: t(statusLabelKey(p.suspected!.status)),
                })}
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {formatRelative(i18n.language, p.suspected!.since)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
