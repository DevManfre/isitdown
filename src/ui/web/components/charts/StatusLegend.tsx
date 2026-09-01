import { useTranslation } from "react-i18next";
import { STATUS_CHART, statusFill, statusLabelKey, statusMuted } from "@/lib/chartConfig.ts";

/**
 * The colour key the daily bars never had.
 *
 * Hand-rolled rather than shadcn's `ChartLegendContent`: that primitive renders
 * from Recharts' legend payload, which carries one entry per *series*.
 * `UptimeBarRow` draws a single `<Bar>` and colours it per `<Cell>`, so its
 * payload is one nameless entry — five statuses cannot come out of it. The
 * swatches therefore read `STATUS_CHART` directly, which is also the order they
 * are listed in: operational through major outage, then unknown.
 *
 * One legend covers both bar rows in the drawer — the provider's own and every
 * component's — because they are painted from the same five colours.
 */
export function StatusLegend() {
  const { t } = useTranslation();

  return (
    <ul
      aria-label={t("history.legend-title")}
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
    >
      {Object.keys(STATUS_CHART).map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-[2px]"
            style={{ background: statusFill(status), opacity: statusMuted(status) ? 0.45 : 1 }}
          />
          {t(statusLabelKey(status))}
        </li>
      ))}
    </ul>
  );
}
