import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useCoincidence, useConfigChrome, useServiceMutations } from "@/hooks/queries.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { stagger } from "@/lib/stagger.ts";
import type { CoincidentPair } from "@/lib/types.ts";
import { useNames } from "./shared.ts";
import { Fill, WidgetCard } from "./WidgetCard.tsx";

const key = (pair: CoincidentPair) => `${pair.providerId}>${pair.otherId}`;

/**
 * Providers that go down together, from ninety days of incidents. The bar is
 * the share of one provider's incidents the other was in; a pair nobody has
 * declared yet offers to become a `dependsOn`, so one cause stops paging twice.
 */
export function Coincidence() {
  const { t, i18n } = useTranslation();
  const name = useNames();
  const { data } = useCoincidence(OVERVIEW_WINDOW_DAYS);
  const { data: config } = useConfigChrome();
  const [announced, setAnnounced] = useState("");
  const { patch } = useServiceMutations();
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = t("dashboard.widget.coincidence.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const pairs = [...data.pairs].sort((a, b) => b.together - a.together || b.rate - a.rate);
  const meta = t("widget.coincidence.meta", { days: data.days });
  if (pairs.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.coincidence.none", { days: data.days })}</p>
      </WidgetCard>
    );
  }

  const top = pairs[0]!;
  const pct = (v: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 }).format(v);
  const conclusion = t(top.declared ? "widget.coincidence.declared-top" : "widget.coincidence.top", {
    a: name(top.providerId),
    b: name(top.otherId),
    together: top.together,
    incidents: top.incidents,
  });

  // The new list is the provider's current one plus this upstream, so the
  // button waits for the configuration: patching from an empty fallback would
  // replace every dependency the provider already declares.
  const configReady = config !== undefined;
  const declare = async (pair: CoincidentPair) => {
    if (config === undefined) return;
    const current = config.services.find((s) => s.id === pair.providerId)?.dependsOn ?? [];
    setError(null);
    setAnnounced("");
    setDeclaring(key(pair));
    try {
      await patch.mutateAsync({ id: pair.providerId, patch: { dependsOn: [...new Set([...current, pair.otherId])] } });
      setAnnounced(t("widget.coincidence.declared-now", { a: name(pair.providerId), b: name(pair.otherId) }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeclaring(null);
    }
  };

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      <div className="flex flex-col gap-1 @md:hidden">
        <span className="text-[0.95rem] font-medium">{name(top.providerId)} + {name(top.otherId)}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("widget.coincidence.times", { together: top.together, incidents: top.incidents })}
        </span>
      </div>

      <ul className="hidden flex-col @md:flex">
        {pairs.map((pair, index) => (
          <li
            key={key(pair)}
            className="anim-rise anim-rise-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-border py-2.5 @2xl:grid-cols-[13rem_minmax(0,1fr)_17rem]"
            style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">{name(pair.providerId)} + {name(pair.otherId)}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {t("widget.coincidence.times", { together: pair.together, incidents: pair.incidents })}
              </span>
            </span>
            <span className="text-right font-mono text-xs @2xl:hidden">{pct(pair.rate)}</span>
            <Fill
              value={pair.rate}
              color="var(--status-degraded)"
              className="col-span-2 @2xl:col-span-1"
              delay={stagger(index, { base: 220, step: 60 })}
              label={t("widget.coincidence.bar", { a: name(pair.providerId), b: name(pair.otherId), rate: pct(pair.rate) })}
            />
            <span className="col-span-2 flex justify-end @2xl:col-span-1">
              <AnimatePresence mode="wait" initial={false}>
                {pair.declared ? (
                  <motion.span
                    key="declared"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-1.5 font-mono text-xs text-[var(--status-operational)]"
                  >
                    <Check aria-hidden="true" className="size-3.5" />
                    {t("widget.coincidence.declared")}
                  </motion.span>
                ) : pair.together >= 3 ? (
                  <motion.span key="action" exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.16 }}>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      disabled={declaring !== null || !configReady}
                      onClick={() => void declare(pair)}
                    >
                      {declaring === key(pair)
                        ? t("widget.coincidence.declaring")
                        : t("widget.coincidence.declare", { a: name(pair.providerId), b: name(pair.otherId) })}
                    </Button>
                  </motion.span>
                ) : (
                  <span key="few" className="font-mono text-xs text-muted-foreground">
                    {t("widget.coincidence.few")}
                  </span>
                )}
              </AnimatePresence>
            </span>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {announced}
      </p>
      {error !== null && (
        <p role="alert" className="text-sm text-[var(--status-major-outage)]">
          {t("widget.coincidence.failed", { error })}
        </p>
      )}
    </WidgetCard>
  );
}
