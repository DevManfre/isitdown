import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useTrust } from "@/hooks/queries.ts";
import { suspectedHatchCss } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { TrustCardData } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { useNames } from "./shared.ts";
import { TRUST_DAYS } from "./PageDelay.tsx";
import { WidgetCard } from "./WidgetCard.tsx";

/** A pair that cleared the floor: its counts mean something. */
const counted = (cards: readonly TrustCardData[]) =>
  cards.filter((c) => c.floor === undefined && c.counted > 0 && c.never !== undefined);
const share = (c: TrustCardData) => (c.counted - (c.never ?? 0)) / c.counted;

/**
 * How honest the page is — widget 17. Of the failures our probe saw, how many
 * the provider's own page ever admitted: the trust card's "never admitted"
 * axis (roadmap 8.1) for every page, the least forthcoming first.
 */
export function PageHonesty() {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const { data } = useTrust(TRUST_DAYS);
  const title = t("dashboard.widget.page-honesty.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = counted(data.cards).sort((a, b) => share(a) - share(b));
  if (rows.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.page-honesty.none")}</p>
        <Link to={ROUTE_PATHS.providers} className="text-sm text-primary hover:underline">
          {t("widget.page-delay.add-probe")}
        </Link>
      </WidgetCard>
    );
  }

  const pct = (v: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const worst = rows[0]!;
  const best = rows[rows.length - 1]!;
  const conclusion =
    rows.length === 1 || share(worst) === share(best)
      ? t("widget.page-honesty.one", { provider: name(worst.pair.pageId), share: pct(share(worst)) })
      : t("widget.page-honesty.conclusion", {
          worst: name(worst.pair.pageId),
          worstShare: pct(share(worst)),
          best: name(best.pair.pageId),
          bestShare: pct(share(best)),
        });

  return (
    <WidgetCard title={title} meta={t("widget.page-honesty.meta", { days: data.days })} conclusion={conclusion} className="@container">
      <div className="flex flex-col gap-1 @md:hidden">
        <span className="font-mono text-4xl leading-none">{pct(share(worst))}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("widget.page-honesty.admitted-by", { provider: name(worst.pair.pageId) })}
        </span>
      </div>

      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-4 @md:grid">
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.col.provider")}</span>
        <span className="pb-1.5 font-mono text-xs text-muted-foreground">{t("widget.page-honesty.col-bar")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.page-honesty.col-admitted")}</span>
        <span className="pb-1.5 text-right font-mono text-xs text-muted-foreground">{t("widget.page-honesty.col-silent")}</span>
        {rows.map((row, index) => {
          const admitted = row.counted - (row.never ?? 0);
          return (
            <div key={row.key} className="contents">
              <span className="truncate border-t border-border py-2.5 text-sm">{name(row.pair.pageId)}</span>
              <div
                className="anim-row-sweep flex gap-0.5 border-t border-border py-3.5"
                style={{ animationDelay: stagger(index, { base: 180, step: 60 }) }}
                role="img"
                aria-label={t("widget.page-honesty.bar", { provider: name(row.pair.pageId), admitted, counted: row.counted })}
              >
                {admitted > 0 && <span className="h-2 rounded-full bg-primary" style={{ flex: admitted }} />}
                {(row.never ?? 0) > 0 && (
                  // The same stripes a suspected status wears: seen by us, not said by them.
                  <span className="h-2 rounded-full" style={{ flex: row.never, background: suspectedHatchCss("degraded") }} />
                )}
              </div>
              <span className="border-t border-border py-2.5 text-right font-mono text-sm">{admitted}</span>
              <span
                className="border-t border-border py-2.5 text-right font-mono text-sm"
                style={{ color: (row.never ?? 0) > 0 ? "var(--status-degraded)" : undefined }}
              >
                {row.never ?? 0}
              </span>
            </div>
          );
        })}
      </div>
      <p className="hidden font-mono text-xs text-muted-foreground @md:block">{t("widget.page-honesty.legend")}</p>
    </WidgetCard>
  );
}
