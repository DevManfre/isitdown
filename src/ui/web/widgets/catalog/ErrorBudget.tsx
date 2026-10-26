import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { UptimeArc } from "@/components/charts/UptimeArc.tsx";
import { useFilterLabel } from "@/components/DashboardGrid.tsx";
import { DrillLink } from "@/components/DrillLink.tsx";
import { historyHref } from "@/lib/drillDown.ts";
import { useSla } from "@/hooks/queries.ts";
import { formatDuration } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { SlaBudget } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useNames, useSliceIds } from "./shared.ts";
import { Fill, LoadFailed, WidgetCard } from "./WidgetCard.tsx";

type Standing = "over" | "risk" | "ok";

const standing = (b: SlaBudget): Standing =>
  b.spentMinutes > b.budgetMinutes ? "over" : b.willMiss ? "risk" : "ok";
const used = (b: SlaBudget) => (b.budgetMinutes === 0 ? 1 : b.spentMinutes / b.budgetMinutes);
const COLOR: Record<Standing, string> = {
  over: "var(--status-major-outage)",
  risk: "var(--status-partial-outage)",
  ok: "var(--status-operational)",
};
const RANK: Record<Standing, number> = { over: 2, risk: 1, ok: 0 };
const WORD: Record<Standing, string> = {
  over: "widget.error-budget.standing.over",
  risk: "widget.error-budget.standing.risk",
  ok: "widget.error-budget.standing.ok",
};

/**
 * This month's error budget for every provider in the slice that has an SLA
 * target. The bar is how much of the allowance is gone; the tick on it is how
 * much of the month is — a bar past its tick is burning faster than the month
 * can afford.
 */
export function ErrorBudget({ props }: { props: { filter: FleetFilter } }) {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const slice = useSliceIds(props.filter);
  const filterText = useFilterLabel(props.filter);
  const { data, isError, refetch } = useSla();
  const title = t("dashboard.widget.error-budget.title");
  if (isError) return <LoadFailed title={title} retry={() => void refetch()} />;
  if (data === undefined) return <WidgetCard title={title} busy />;

  const month = new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(new Date(`${data.month}-01T12:00:00Z`));
  const budgets = data.providers
    .filter((b) => slice.ids.has(b.providerId))
    .sort((a, b) => RANK[standing(b)] - RANK[standing(a)] || used(b) - used(a));
  const meta = `${slice.filtered ? `${filterText} · ` : ""}${month}`;

  if (budgets.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.error-budget.none")}</p>
        <Link to={ROUTE_PATHS.providers} className="text-sm text-primary hover:underline">
          {t("widget.error-budget.set-target")}
        </Link>
      </WidgetCard>
    );
  }

  const worst = budgets[0]!;
  const pct = (value: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 }).format(value);
  const pace = (b: SlaBudget) => (b.monthMinutes === 0 ? 0 : b.elapsedMinutes / b.monthMinutes);
  const runsOut = (b: SlaBudget) => {
    if (b.spentMinutes === 0) return null;
    const at = (b.elapsedMinutes * b.budgetMinutes) / b.spentMinutes;
    const date = new Date(`${data.month}-01T00:00:00`);
    date.setMinutes(date.getMinutes() + at);
    return new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" }).format(date);
  };
  const conclusion =
    standing(worst) === "over"
      ? t("widget.error-budget.over", { provider: name(worst.providerId), spent: formatDuration(i18n.language, worst.spentMinutes), budget: formatDuration(i18n.language, worst.budgetMinutes) })
      : standing(worst) === "risk"
        ? t("widget.error-budget.risk", { provider: name(worst.providerId), used: pct(used(worst)), month: pct(pace(worst)), date: runsOut(worst) ?? "" })
        : t("widget.error-budget.ok", { provider: name(worst.providerId), used: pct(used(worst)) });
  const word = (b: SlaBudget) => t(WORD[standing(b)]);
  const tone = standing(worst) === "over" ? "alarm" : standing(worst) === "risk" ? "warn" : undefined;

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} tone={tone} className="@container">
      {/* A third: the one closest to the edge, as a ring. */}
      <div className="flex flex-col items-center gap-2 text-center @md:hidden">
        <UptimeArc
          value={Math.min(100, used(worst) * 100)}
          color={COLOR[standing(worst)]}
          label={t("widget.error-budget.ring", { provider: name(worst.providerId), used: pct(used(worst)) })}
        />
        <span className="text-sm">{name(worst.providerId)} · {word(worst)}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("widget.error-budget.left", { time: formatDuration(i18n.language, Math.max(0, worst.remainingMinutes)) })}
        </span>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)] gap-y-3 @md:grid @2xl:grid-cols-[8rem_5rem_minmax(0,1fr)_8rem_7rem] @2xl:items-center @2xl:gap-x-4">
        {budgets.map((b, index) => (
          <div key={b.providerId} className="contents">
            <div className="flex items-baseline justify-between gap-2 @2xl:contents">
              <span className="truncate text-sm">{name(b.providerId)}</span>
              <span className="hidden font-mono text-xs @2xl:block">{b.target}%</span>
              <span className="font-mono text-xs @2xl:hidden" style={{ color: standing(b) === "ok" ? undefined : COLOR[standing(b)] }}>
                {word(b)} · {pct(used(b))}
              </span>
            </div>
            <div className="relative">
              <Fill
                value={used(b)}
                color={COLOR[standing(b)]}
                delay={stagger(index, { base: 200, step: 70 })}
                label={t("widget.error-budget.bar", { provider: name(b.providerId), used: pct(used(b)), month: pct(pace(b)) })}
              />
              <span
                aria-hidden="true"
                className="anim-fade absolute -inset-y-1 w-0.5 rounded bg-foreground/70"
                style={{ left: `${pace(b) * 100}%`, animationDelay: stagger(index, { base: 520, step: 70 }) }}
              />
            </div>
            <span className="hidden font-mono text-xs @2xl:block">
              <DrillLink
                to={historyHref({ provider: b.providerId, days: 30 })}
                label={t("drill.budget-spent", { provider: name(b.providerId), spent: formatDuration(i18n.language, b.spentMinutes) })}
                where={t("drill.where.history", { provider: name(b.providerId), count: 30 })}
              >
                {formatDuration(i18n.language, b.spentMinutes)}
              </DrillLink>{" "}
              / {formatDuration(i18n.language, b.budgetMinutes)}
            </span>
            <span
              className="widget-tone hidden text-right font-mono text-[0.68rem] tracking-wider uppercase @2xl:block"
              style={{ color: COLOR[standing(b)] }}
            >
              {word(b)}
            </span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
