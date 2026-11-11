import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useSla } from "@/hooks/queries.ts";
import { formatPercent } from "@/lib/format.ts";

/**
 * One provider's month against what it was promised — roadmap 4.13.
 *
 * The History view already answers "how has this vendor been". What it cannot
 * answer is "does this vendor meet what we were promised", because that needs
 * a number nobody had written down. With a target on the provider, this card is
 * the answer: the budget the target implies, how much of it the month has
 * spent, and — the only part that is not arithmetic on the past — whether the
 * rate says the month will miss.
 *
 * Absent entirely for a provider with no target. Nobody promised anything about
 * it, and an empty card claiming 100% of nothing is worse than no card.
 */
export function SlaBudgetCard({ providerId }: { providerId: string }) {
  const { t, i18n } = useTranslation();
  const { data } = useSla();

  const budget = data?.providers.find((entry) => entry.providerId === providerId);
  if (budget === undefined) return null;

  const spent = Math.round(budget.spentMinutes);
  const allowed = Math.round(budget.budgetMinutes);
  // Clamped at the full bar: a budget spent twice over is still one bar, and
  // the figures beside it are what say by how much.
  const used = allowed === 0 ? 0 : Math.min(100, (budget.spentMinutes / budget.budgetMinutes) * 100);

  return (
    <section
      aria-label={t("sla.title")}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-medium">{t("sla.title")}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t("sla.target", { target: formatPercent(i18n.language, budget.target) })}
        </span>
      </div>

      {budget.uptime === null ? (
        // Never measured is not 0% — the distinction the whole history service
        // turns on, and the one thing this card must not get wrong about a
        // vendor.
        <p className="text-sm text-muted-foreground">{t("sla.unmeasured")}</p>
      ) : (
        <>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: "var(--color-neutral-800)" }}
            role="img"
            aria-label={t("sla.bar-label", { spent, allowed })}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${used}%`,
                background: budget.willMiss ? "var(--status-major-outage-fill)" : "var(--status-operational-fill)",
              }}
            />
          </div>
          <p className="text-sm">
            {t("sla.spent", { spent, allowed })}
          </p>
          <p className="text-xs text-muted-foreground">
            {budget.willMiss
              ? t("sla.will-miss", { projected: formatPercent(i18n.language, budget.projectedUptime ?? 0) })
              : t("sla.on-track", { projected: formatPercent(i18n.language, budget.projectedUptime ?? 0) })}
            {budget.burnRate !== null && ` · ${t("sla.burn-rate", { rate: budget.burnRate.toFixed(2) })}`}
          </p>
          {/* Roadmap 6.5: a month under target is a month somebody may claim
              a credit for, and the claim needs the windows, not this bar. Only
              when the month is actually below — a hint of money on a vendor
              that is meeting its promise would be noise. */}
          {budget.uptime < budget.target && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span>{t("sla.credit")}</span>
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                <a
                  href={`/export/sla-evidence.md?provider=${encodeURIComponent(providerId)}&month=${budget.month}`}
                  aria-label={t("sla.evidence-label", { month: budget.month })}
                >
                  {t("sla.evidence")}
                </a>
              </Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
