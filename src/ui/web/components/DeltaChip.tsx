import { useTranslation } from "react-i18next";
import { TREND_CHART } from "@/lib/chartConfig.ts";
import { formatSigned } from "@/lib/format.ts";

/**
 * The change against the previous window of equal length, in percentage
 * points.
 *
 * Renders nothing at all when there is no previous window. A fresh install
 * has not fallen from zero, and "0,00 pp" would claim it measured a flat one —
 * which is why the server sends `null` here rather than a number.
 *
 * Shared by the headline and by every provider row, so the rule about what an
 * absent comparison looks like is stated once.
 *
 * The headline is the only delta on screen there, so it spells out what it is
 * being compared against. The provider list's column is already headed
 * "Change" ("Variazione"), so a row passes `compact` to drop the sentence
 * down to just the figure — otherwise it re-states the column heading and
 * outgrows the column.
 */
export function DeltaChip({
  current, previous, days, compact = false,
}: {
  current: number;
  previous: number | null;
  days: number;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (previous === null) return null;

  const delta = Math.round((current - previous) * 100) / 100;
  const colour = delta > 0 ? TREND_CHART.rise : delta < 0 ? TREND_CHART.fall : undefined;
  const value = formatSigned(i18n.language, delta);

  return (
    <span
      className="font-mono text-xs"
      style={colour === undefined ? undefined : { color: colour }}
    >
      {compact ? t("history.delta-short", { value }) : t("history.delta", { value, days })}
    </span>
  );
}
