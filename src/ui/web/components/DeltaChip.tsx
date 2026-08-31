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
 */
export function DeltaChip({
  current, previous, days,
}: {
  current: number;
  previous: number | null;
  days: number;
}) {
  const { t, i18n } = useTranslation();
  if (previous === null) return null;

  const delta = Math.round((current - previous) * 100) / 100;
  const colour = delta > 0 ? TREND_CHART.rise : delta < 0 ? TREND_CHART.fall : undefined;

  return (
    <span
      className="font-mono text-xs"
      style={colour === undefined ? undefined : { color: colour }}
    >
      {t("history.delta", { value: formatSigned(i18n.language, delta), days })}
    </span>
  );
}
