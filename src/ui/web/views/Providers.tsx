import { useEffect, useState } from "react";
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

/** How long a dropped row stays mounted; in step with `.anim-sink` in motion.css. */
const EXIT_MS = 220;

type Filter = "all" | "issues";

/**
 * The ids the filter has just dropped, held for one exit-animation beat.
 *
 * An unmounted row cannot animate, so flipping to "issues" used to blink the
 * operational rows out of existence while the arriving ones rose in. Keeping
 * each dropped row mounted for the length of `.anim-sink` buys the leave the
 * choreography the entry already had.
 */
function useLeavingIds(shownIds: readonly string[]): ReadonlySet<string> {
  // The ids themselves are the identity of a render: `shownIds` is a fresh
  // array every time, and only a change of membership means anything here.
  const key = shownIds.join(",");
  const [tracked, setTracked] = useState<{ key: string; leaving: ReadonlySet<string> }>(() => ({
    key,
    leaving: new Set(),
  }));

  // Worked out during the render that first sees the new filter, not in an
  // effect afterwards: React discards this pass and re-runs it with `leaving`
  // already filled, so the dropped rows stay in the DOM they are in. An effect
  // would commit one paint without them first, and the row would be torn down
  // and rebuilt just to fade — a flash, which is the thing being fixed.
  if (tracked.key !== key) {
    const shown = new Set(shownIds);
    const gone = tracked.key === "" ? [] : tracked.key.split(",").filter((id) => !shown.has(id));
    setTracked({ key, leaving: new Set(gone) });
  }

  useEffect(() => {
    if (tracked.leaving.size === 0) return;
    // Reduced motion plays no exit animation, so there is nothing to wait for.
    const hold = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : EXIT_MS;
    const timer = setTimeout(() => setTracked((current) => ({ key: current.key, leaving: new Set() })), hold);
    return () => clearTimeout(timer);
  }, [tracked]);

  return tracked.leaving;
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
  const [filter, setFilter] = useState<Filter>("all");

  const providers = status?.providers ?? [];
  const byId = new Map(summaryProviders(summary).map((p) => [p.providerId, p]));

  // providers.js:64-67 — showIssuesOnly filters client-side to providers with
  // an open issue; the "all" fleet is otherwise shown in its configured order.
  const filtered = filter === "issues" ? providers.filter((p) => p.overallStatus !== "operational") : providers;
  const shownIds = filtered.map((p) => p.id);
  const shown = new Set(shownIds);
  // Sits above the empty-state return below: a hook cannot go behind one.
  const leaving = useLeavingIds(shownIds);

  if (providers.length === 0) {
    return <p className="text-muted-foreground">{t("providers.empty")}</p>;
  }

  // A row the filter has just dropped keeps its slot until `.anim-sink` has
  // played, so the table empties the way it fills instead of blinking.
  const rows = providers.filter((p) => shown.has(p.id) || leaving.has(p.id));

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
      {rows.length === 0 ? (
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
            {rows.map((provider, index) => {
              const history = byId.get(provider.id);
              const isLeaving = leaving.has(provider.id);
              return (
                <TableRow
                  key={provider.id}
                  // A disabled provider is still listed, only dimmed: its
                  // history is real either way.
                  className={cn(
                    isLeaving ? "anim-sink" : "anim-rise anim-rise-table-row",
                    !provider.enabled && "opacity-55",
                  )}
                  // A row on its way out goes at once; only arrivals stagger.
                  style={{ animationDelay: isLeaving ? "0ms" : `${index * 60}ms` }}
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
