import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useStatus } from "@/hooks/queries.ts";
import { drawOrder, statusColor, statusLabelKey, statusTier } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { useNames } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

/**
 * Every group and the status the server derived for it (roadmap 2.6) —
 * widget 18. Worst first; a member that is the reason is named in the status
 * colour, the others stay quiet, so "which one" is answered on the row.
 */
export function Groups() {
  const { t } = useTranslation();
  const name = useNames();
  const { data: status } = useStatus();
  const title = t("dashboard.widget.groups.title");
  if (status === undefined) return <WidgetCard title={title} busy />;

  const groups = [...(status.groups ?? [])].sort(
    (a, b) => drawOrder(statusTier(b.status)) - drawOrder(statusTier(a.status)) || a.id.localeCompare(b.id),
  );
  if (groups.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.groups.none")}</p>
        <Link to={ROUTE_PATHS.providers} className="text-sm text-primary hover:underline">
          {t("widget.groups.create")}
        </Link>
      </WidgetCard>
    );
  }

  const hit = groups.filter((g) => g.affected.length > 0).length;

  return (
    <WidgetCard
      title={title}
      meta={t("widget.groups.meta", { count: groups.length, hit })}
      tone={hit > 0 ? "warn" : undefined}
      className="@container"
    >
      {/* A third: one tile per group, the status in words. */}
      <ul className="grid grid-cols-2 gap-2 @md:hidden">
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              to={ROUTE_PATHS.providers}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-lg border p-2.5 hover:text-primary",
                g.affected.length > 0 ? "border-[var(--status-outage-border)]" : "border-border",
              )}
            >
              <span className="truncate text-sm">{g.id}</span>
              <span className="font-mono text-[0.65rem] tracking-wider uppercase" style={{ color: statusColor(g.status) }}>
                {t(statusLabelKey(g.status))}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <ul className="hidden flex-col @md:flex">
        {groups.map((g, index) => (
          <li key={g.id} className="border-t border-border">
            <Link
              to={ROUTE_PATHS.providers}
              className="anim-rise anim-rise-row flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm py-2.5 text-sm hover:text-primary"
              style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
            >
              <StatusDot status={g.status} />
              <span className="w-32 shrink-0 font-mono text-[0.68rem] tracking-wider uppercase" style={{ color: statusColor(g.status) }}>
                {t(statusLabelKey(g.status))}
              </span>
              <span className="w-28 shrink-0 truncate font-medium">{g.id}</span>
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {g.providers.map((id) => (
                  <span
                    key={id}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]"
                    style={{ color: g.affected.includes(id) ? statusColor(g.status) : undefined }}
                  >
                    {name(id)}
                  </span>
                ))}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {t("widget.groups.healthy", { up: g.providers.length - g.affected.length, total: g.providers.length })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
