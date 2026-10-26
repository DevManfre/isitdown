import { useTranslation } from "react-i18next";
import { DrillLink } from "@/components/DrillLink.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { useReliability } from "@/hooks/queries.ts";
import { incidentsHref } from "@/lib/drillDown.ts";
import { stagger } from "@/lib/stagger.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useNames, useSliceIds } from "./shared.ts";
import { Fill, WidgetCard } from "./WidgetCard.tsx";

const DAYS = 30;
/** Bars before the tail folds into one "the others" row. */
const SHOWN = 4;

/**
 * Who has had the most incidents — widget 23. A ranking over thirty days, each
 * count a link to the incidents behind it; the long tail folds into one row so
 * the widget stays a summary however large the fleet.
 */
export function Noisy({ props }: { props: { filter: FleetFilter } }) {
  const { t } = useTranslation();
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data } = useReliability(DAYS);
  const title = t("dashboard.widget.noisy.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = data.providers
    .filter((r) => slice.ids.has(r.providerId) && r.incidents > 0)
    .sort((a, b) => b.incidents - a.incidents || a.providerId.localeCompare(b.providerId));
  const total = rows.reduce((sum, r) => sum + r.incidents, 0);
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${t("widget.noisy.meta", { days: data.days, count: total })}`;

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.noisy.none", { days: data.days })}</p>
      </WidgetCard>
    );
  }

  const top = rows[0]!;
  const shown = rows.slice(0, SHOWN);
  const rest = rows.slice(SHOWN);
  const restCount = rest.reduce((sum, r) => sum + r.incidents, 0);
  const quiet = slice.providers.length - rows.length;
  const conclusion =
    quiet === 0
      ? t("widget.noisy.conclusion-everyone", { provider: name(top.providerId), count: top.incidents, total })
      : t("widget.noisy.conclusion", { provider: name(top.providerId), count: top.incidents, total, quiet });
  const link = (providerId: string | null, count: number, children: string) => (
    <DrillLink
      to={incidentsHref({ provider: providerId, days: data.days })}
      label={
        providerId === null
          ? t("widget.noisy.rest-label", { count, days: data.days })
          : t("drill.provider-incidents", { provider: name(providerId), count, days: data.days })
      }
      where={
        providerId === null
          ? t("drill.where.incidents-all", { count: data.days })
          : t("drill.where.incidents", { provider: name(providerId), count: data.days })
      }
    >
      {children}
    </DrillLink>
  );

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      <div className="flex items-baseline gap-2.5 @md:hidden">
        <span className="text-lg">{name(top.providerId)}</span>
        <span className="font-mono text-lg">{link(top.providerId, top.incidents, String(top.incidents))}</span>
        <span className="font-mono text-xs text-muted-foreground">{t("widget.noisy.of", { total })}</span>
      </div>

      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-x-4 @md:grid">
        {shown.map((row, index) => (
          <div key={row.providerId} className="contents">
            <span className="truncate border-t border-border py-2.5 text-sm">{name(row.providerId)}</span>
            <div className="border-t border-border py-3.5">
              <Fill value={row.incidents / top.incidents} color="var(--primary)" delay={stagger(index, { base: 180, step: 60 })} />
            </div>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm">
              {link(row.providerId, row.incidents, String(row.incidents))}
            </span>
          </div>
        ))}
        {rest.length > 0 && (
          <div className="contents">
            <span className="truncate border-t border-border py-2.5 text-sm text-muted-foreground">
              {t("widget.noisy.others", { count: rest.length })}
            </span>
            <div className="border-t border-border py-3.5">
              <Fill value={Math.min(1, restCount / top.incidents)} color="var(--muted-foreground)" delay={stagger(SHOWN, { base: 180, step: 60 })} />
            </div>
            <span className="border-t border-border py-2.5 text-right font-mono text-sm">{link(null, restCount, String(restCount))}</span>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}
