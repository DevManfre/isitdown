import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck } from "lucide-react";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useIncidents } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatDuration, formatRelative } from "@/lib/format.ts";
import { impactKey, impactStatus, incidentStatusKey } from "@/lib/incidents.ts";
import { statusColor } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { IncidentRow } from "@/lib/types.ts";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { MINUTE, useNames, useSliceIds } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const href = (row: IncidentRow) =>
  ROUTE_PATHS.incidentDetail.replace(":providerId", row.providerId).replace(":incidentId", row.incidentId);

/**
 * Worst impact first, then the one open longest. By the impact the page
 * declared, not by its colour tier: "major" and "minor" share the amber tier,
 * and a minor one must not sit above a major one because it is older.
 */
const IMPACT_RANK: Record<string, number> = { critical: 3, major: 2, minor: 1, none: 0 };
const order = (a: IncidentRow, b: IncidentRow) =>
  (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) || Date.parse(a.startedAt) - Date.parse(b.startedAt);

/**
 * Open incidents across the slice — the widget that answers "is there
 * something I should be reading right now?". Rows that arrive or close on a
 * refresh slide in and fold away instead of the list re-flowing in one frame.
 */
export function OpenIncidents({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE / 2);
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useIncidents({ state: "active", pageSize: 1 });
  const { data: last } = useIncidents({ state: "resolved", pageSize: 1 });

  const all = data?.active ?? [];
  const open = all.filter((row) => slice.ids.has(row.providerId)).sort(order);
  const age = (row: IncidentRow) => formatDuration(i18n.language, (now - Date.parse(row.startedAt)) / MINUTE);
  const oldest = open.reduce<IncidentRow | undefined>(
    (worst, row) => (worst === undefined || row.startedAt < worst.startedAt ? row : worst),
    undefined,
  );
  const title = t("dashboard.widget.open-incidents.title");

  if (data === undefined) return <WidgetCard title={title} busy />;

  if (open.length === 0) {
    const lastClosed = last?.page.items[0];
    return (
      <WidgetCard title={title} meta={slice.filtered ? filterText : t("widget.open-incidents.none-meta")}>
        <div className="flex items-start gap-3 text-sm">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--status-operational)]" />
          <span>
            {slice.filtered && all.length > 0
              ? t("widget.open-incidents.none-here", { count: all.length })
              : lastClosed?.resolvedAt != null
                ? t("widget.open-incidents.none-since", {
                    provider: name(lastClosed.providerId),
                    since: formatRelative(i18n.language, lastClosed.resolvedAt),
                  })
                : t("widget.open-incidents.none")}
          </span>
        </div>
      </WidgetCard>
    );
  }

  const meta = (
    <>
      {slice.filtered && `${filterText} · `}
      {t("widget.open-incidents.meta", { count: open.length, age: oldest === undefined ? "" : age(oldest) })}
    </>
  );

  return (
    <WidgetCard title={title} meta={meta} tone={open.some((r) => impactStatus(r.impact) === "major_outage") ? "alarm" : undefined} className="@container">
      {/* At a third: the count, and the one to open first. */}
      <div className="flex flex-col gap-3 @md:hidden">
        <div className="flex items-baseline gap-3">
          <NumberTicker className="font-mono text-4xl leading-none" locale={i18n.language} value={open.length} />
          <span className="font-mono text-xs text-muted-foreground">{t("widget.open-incidents.count", { count: open.length })}</span>
        </div>
        <Link to={href(open[0]!)} className="flex min-w-0 items-center gap-2 border-t border-border pt-2.5 text-sm hover:text-primary">
          <StatusDot status={impactStatus(open[0]!.impact)} label={t(impactKey(open[0]!.impact))} />
          <span className="truncate">{name(open[0]!.providerId)} · {open[0]!.name}</span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{age(open[0]!)}</span>
        </Link>
      </div>

      <ul className="hidden flex-col @md:flex">
        <AnimatePresence initial={false}>
          {open.map((row, index) => (
            <motion.li
              key={`${row.providerId}/${row.incidentId}`}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t border-border"
            >
              <Link
                to={href(row)}
                className="anim-rise anim-rise-row grid items-center rounded-sm focus-visible:outline-offset-[-2px] gap-x-4 gap-y-1 py-2.5 text-sm hover:text-primary grid-cols-[minmax(0,1fr)_auto] @2xl:grid-cols-[8rem_7rem_minmax(0,1fr)_5rem] @4xl:grid-cols-[8rem_7rem_minmax(0,1fr)_11rem_5rem]"
                style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
              >
                <span className="flex min-w-0 items-center gap-2 @2xl:col-auto">
                  <StatusDot status={impactStatus(row.impact)} />
                  <span className="font-mono text-[0.68rem] tracking-wider uppercase" style={{ color: statusColor(impactStatus(row.impact)) }}>
                    {t(impactKey(row.impact))}
                  </span>
                  <span className="truncate font-medium @2xl:hidden">{name(row.providerId)}</span>
                </span>
                <span className="text-right font-mono text-xs text-muted-foreground @2xl:hidden">{age(row)}</span>
                <span className="hidden truncate @2xl:block">{name(row.providerId)}</span>
                <span className="col-span-2 truncate text-muted-foreground @2xl:col-span-1 @2xl:text-foreground">{row.name}</span>
                <span className="hidden truncate font-mono text-xs text-muted-foreground @4xl:block">
                  {t(incidentStatusKey(row.status))} · {formatRelative(i18n.language, row.updatedAt)}
                </span>
                <span className="hidden text-right font-mono text-xs @2xl:block">{age(row)}</span>
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </WidgetCard>
  );
}
