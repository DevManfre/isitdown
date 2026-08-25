import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatPercent } from "@/lib/format.ts";
import { cn } from "@/lib/utils.ts";
import type { HistoryBucket, HistorySummary, ProviderHistory } from "@/lib/types.ts";

const WINDOW_DAYS = 90;

/**
 * `useHistory(WINDOW_DAYS)` is called with no provider, so the API
 * guarantees a `HistorySummary` — but its declared return type is the same
 * undiscriminated union `getHistory` always carries. `"providers" in value`
 * narrows without a cast: only `HistorySummary` has that field.
 */
function summaryProviders(
  value: HistorySummary | ProviderHistory | undefined,
): { providerId: string; buckets: HistoryBucket[]; uptime90: number; incidentCount: number }[] {
  return value !== undefined && "providers" in value ? value.providers : [];
}

/**
 * Design 3a's Providers table: one row per configured provider with its
 * status, an inline uptime strip, and its uptime and incident counts.
 *
 * Read-only by design — adding, editing and removing a provider all live in
 * Settings (Task 12), so a glance at the fleet can never turn into an
 * accidental edit. Straight port of src/ui/public/js/views/providers.js,
 * minus the edit/remove buttons and add-service dialog that move there.
 */
export function Providers() {
  const { t, i18n } = useTranslation();
  const { data: status } = useStatus();
  const { data: summary } = useHistory(WINDOW_DAYS);

  const providers = status?.providers ?? [];
  const byId = new Map(summaryProviders(summary).map((p) => [p.providerId, p]));

  if (providers.length === 0) {
    return <p className="text-muted-foreground">{t("providers.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="anim-fade text-sm text-muted-foreground">{t("providers.intro")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("column.provider")}</TableHead>
            <TableHead>{t("column.adapter")}</TableHead>
            <TableHead>{t("column.status")}</TableHead>
            <TableHead>{t("column.uptime")}</TableHead>
            <TableHead>{t("column.incidents")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers.map((provider, index) => {
            const history = byId.get(provider.id);
            return (
              <TableRow
                key={provider.id}
                // A disabled provider is still listed, only dimmed: its
                // history is real either way.
                className={cn("anim-rise-table-row", !provider.enabled && "opacity-55")}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <StatusDot status={provider.overallStatus} glow={8} />
                    <span>{provider.name}</span>
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{provider.adapter}</TableCell>
                <TableCell style={{ color: statusColor(provider.overallStatus) }}>
                  {t(statusLabelKey(provider.overallStatus))}
                </TableCell>
                <TableCell className="min-w-40">
                  <span className="flex items-center gap-3">
                    <UptimeStrip buckets={history?.buckets ?? []} />
                    <span className="font-mono text-xs">
                      {formatPercent(i18n.language, history?.uptime90 ?? provider.uptime90)}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{history?.incidentCount ?? 0}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
