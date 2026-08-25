import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { UptimeStrip } from "@/components/charts/UptimeStrip.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatPercent, hostOf } from "@/lib/format.ts";
import { summaryProviders } from "@/lib/history.ts";
import { cn } from "@/lib/utils.ts";

const WINDOW_DAYS = 90;

type Filter = "all" | "issues";

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
  const [filter, setFilter] = useState<Filter>("all");

  const providers = status?.providers ?? [];
  const byId = new Map(summaryProviders(summary).map((p) => [p.providerId, p]));

  if (providers.length === 0) {
    return <p className="text-muted-foreground">{t("providers.empty")}</p>;
  }

  // providers.js:64-67 — showIssuesOnly filters client-side to providers with
  // an open issue; the "all" fleet is otherwise shown in its configured order.
  const filtered = filter === "issues" ? providers.filter((p) => p.overallStatus !== "operational") : providers;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="anim-fade text-sm text-muted-foreground">{t("providers.intro")}</p>
        {/* providers.js:73-97 (headerRow) — a seg-pills toggle beside the
            intro line. `type="multiple"` (not "single") so Radix leaves the
            plain `aria-pressed` attribute alone instead of swapping it for
            `role="radio"`/`aria-checked` — matching this codebase's own
            convention (Header.tsx's language switcher) and motion.css's
            `[data-slot="toggle-group-item"]` transition hook either way.
            Single-selection is enforced by hand below. */}
        <ToggleGroup
          type="multiple"
          value={[filter]}
          onValueChange={(next) => {
            // Clicking the already-active option yields an empty array
            // (providers.js:86's no-op guard); a real change yields the
            // newly-picked option alongside the outgoing one.
            const picked = next.find((v) => v !== filter);
            if (picked === "all" || picked === "issues") setFilter(picked);
          }}
        >
          <ToggleGroupItem value="all">{t("filter.all")}</ToggleGroupItem>
          <ToggleGroupItem value="issues">{t("filter.issues")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {filtered.length === 0 ? (
        <p className="text-muted-foreground">{t("providers.empty")}</p>
      ) : (
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
            {filtered.map((provider, index) => {
              const history = byId.get(provider.id);
              return (
                <TableRow
                  key={provider.id}
                  // A disabled provider is still listed, only dimmed: its
                  // history is real either way.
                  className={cn("anim-rise anim-rise-table-row", !provider.enabled && "opacity-55")}
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <StatusDot status={provider.overallStatus} glow={8} />
                      <span className="flex flex-col">
                        <span>{provider.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {hostOf(provider.baseUrl)}
                        </span>
                      </span>
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
      )}
    </div>
  );
}
