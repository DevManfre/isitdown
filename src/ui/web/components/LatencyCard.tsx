import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { LatencyChart } from "@/components/charts/LatencyChart.tsx";
import { useLatency } from "@/hooks/queries.ts";
import { formatNumber } from "@/lib/format.ts";
import type { LatencyRange } from "@/lib/types.ts";

// Each label key spelled out rather than built from the range: a key assembled
// at runtime is invisible to the catalog guard, which is what keeps a dead or
// missing string from shipping.
const RANGES: { value: LatencyRange; labelKey: string }[] = [
  { value: "24h", labelKey: "latency.range.24h" },
  { value: "7d", labelKey: "latency.range.7d" },
  { value: "30d", labelKey: "latency.range.30d" },
];

/**
 * Response-time percentiles for one provider at a time — roadmap 4.14.
 *
 * One picker rather than a chart per provider: a fleet of forty would be forty
 * charts of mostly the same flat line, and the question this answers is asked
 * about one vendor at a time.
 */
export function LatencyCard({ providers }: { providers: { id: string; name: string }[] }) {
  const { t, i18n } = useTranslation();
  const [chosen, setChosen] = useState<string | null>(null);
  const [range, setRange] = useState<LatencyRange>("7d");
  const selected = providers.find((provider) => provider.id === chosen) ?? providers[0];
  const { data: latency } = useLatency(selected?.id ?? "", range);

  if (selected === undefined) return null;
  const number = (value: number) => formatNumber(i18n.language, value);

  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={t("latency.title")} role="region">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("latency.title")}</span>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selected.id} onValueChange={setChosen}>
            <SelectTrigger size="sm" aria-label={t("latency.provider")} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(next) => {
              if (next !== "") setRange(next as LatencyRange);
            }}
          >
            {RANGES.map(({ value, labelKey }) => (
              <ToggleGroupItem key={value} value={value} aria-label={t(labelKey)}>
                {value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {latency === undefined ? (
        <Skeleton className="h-44 w-full" />
      ) : latency.summary === null ? (
        <p className="py-6 text-sm text-muted-foreground">{t("latency.empty")}</p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("latency.stat.p50")}</dt>
              <dd className="font-mono text-xl">{t("latency.ms", { value: number(latency.summary.p50) })}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("latency.stat.p95")}</dt>
              <dd className="font-mono text-xl">{t("latency.ms", { value: number(latency.summary.p95) })}</dd>
            </div>
            {latency.slowMs !== null && latency.summary.overSlow !== null ? (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("latency.stat.slow", { ms: number(latency.slowMs) })}
                </dt>
                <dd className="font-mono text-xl">{number(latency.summary.overSlow)}</dd>
              </div>
            ) : null}
          </dl>
          <LatencyChart
            latency={latency}
            label={t("latency.chart", {
              name: selected.name,
              p50: number(latency.summary.p50),
              p95: number(latency.summary.p95),
            })}
          />
        </>
      )}
    </Card>
  );
}
