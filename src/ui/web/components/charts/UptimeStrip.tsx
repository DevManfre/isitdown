import { memo } from "react";
import { useTranslation } from "react-i18next";
import { statusFill, statusMuted } from "@/lib/chartConfig.ts";
import { tallyStatuses } from "@/lib/chartSummary.ts";
import type { HistoryBucket } from "@/lib/types.ts";

/**
 * Not a chart — a strip. No Recharts, no ChartContainer.
 *
 * The compact inline variant used inside the providers table and under an
 * expanded row. Every bar is the same height and carries no axis, no tooltip
 * and nothing to hover: it is a run of colours, which is exactly how
 * design/claude-design-prototypes/component-monitoring/ComponentRows.dc.html
 * draws it. A chart library was never what the prototype asked for, and one
 * strip on Recharts cost ~59ms and 273 DOM nodes to mount, plus a
 * ResponsiveContainer's ResizeObserver and one injected `<style>` tag each —
 * multiplied by every provider times every component it monitors, which is
 * what made a large fleet stall. `UptimeBarRow` stays on Recharts: its tooltip
 * is real chart behaviour.
 *
 * Memoised because a `/status` poll moves `fetchedAt` on every provider and
 * rebuilds the table's rows, while `buckets` comes from the separate history
 * query and keeps its identity — so a poll re-renders no strip at all.
 */
export const UptimeStrip = memo(function UptimeStrip({ buckets }: { buckets: HistoryBucket[] }) {
  const { t } = useTranslation();
  return (
    // `anim-bar anim-bar-strip` is motion.css's entry animation for a bar
    // (bar-grow out of the baseline, at the strip's own 0.45s); the wrapper has
    // to keep carrying it, and the transform-origin that goes with it.
    <span
      // A run of coloured rects is nothing to a screen reader, so the strip
      // states what it draws (roadmap 5.13) and its bars stay out of the
      // accessibility tree: the sentence is the whole content.
      role="img"
      aria-label={t("chart.days-summary", tallyStatuses(buckets.map((bucket) => bucket.status)))}
      className="anim-bar anim-bar-strip flex h-3 w-full items-center gap-[1.5px]"
    >
      {buckets.map((bucket) => (
        <span
          key={bucket.day}
          // The status the bar is drawing, as a data attribute — StatusDot's
          // idiom. It is what a test reads (and what the bar *means*), rather
          // than a colour a restyle could change without changing the meaning.
          data-status={bucket.status}
          className="h-full min-w-px flex-1 rounded-[1px]"
          style={{
            background: statusFill(bucket.status),
            // A day nobody measured must not read as loud as a day that was down.
            opacity: statusMuted(bucket.status) ? 0.45 : 1,
          }}
        />
      ))}
    </span>
  );
});
