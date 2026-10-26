import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { DrillLink } from "@/components/DrillLink.tsx";
import { useHistory, useStatus } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { OVERVIEW_WINDOW_DAYS } from "@/lib/fleetSlice.ts";
import { formatDuration } from "@/lib/format.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { MINUTE } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

/** Missed this many cycles in a row and the poller is called stopped, not late. */
const STALLED_CYCLES = 2;

/**
 * Is the loop still going round — widget 21. When the last cycle ran, when the
 * next is due, how many providers answered it, and how much of the last day
 * the poller covered (roadmap 10.1). A stopped poller freezes every other
 * widget on the page without any of them knowing; this one says so.
 */
export function PollerPulse() {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE / 4);
  const { data: status } = useStatus();
  const { data: history } = useHistory({ days: OVERVIEW_WINDOW_DAYS });
  const title = t("dashboard.widget.poller-pulse.title");
  if (status === undefined) return <WidgetCard title={title} busy />;

  const interval = status.pollIntervalMinutes;
  const enabled = status.providers.filter((p) => p.enabled);
  const answered = enabled.filter((p) => p.failureCount === 0 && p.fetchedAt !== null).length;
  const last = status.lastPollAt === null ? null : Date.parse(status.lastPollAt);
  const next = status.nextPollAt === null ? null : Date.parse(status.nextPollAt);
  const stalled = last === null || now - last > STALLED_CYCLES * interval * MINUTE;
  // The window's coverage, not today's: a day that began an hour ago reads as
  // a few percent covered however well the poller is doing.
  const covered = history !== undefined && "coverage" in history ? history.coverage : null;
  const ago = (at: number) => formatDuration(i18n.language, Math.max(0, now - at) / MINUTE);
  const pct = (v: number) => new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 }).format(v);
  const silent = enabled.length - answered;

  const conclusion =
    last === null
      ? t("widget.poller-pulse.never")
      : stalled
        ? t("widget.poller-pulse.stalled", { time: ago(last) })
        : covered === null
          ? t("widget.poller-pulse.alive", { answered, total: enabled.length })
          : t("widget.poller-pulse.alive-coverage", { answered, total: enabled.length, coverage: pct(covered), days: OVERVIEW_WINDOW_DAYS });

  return (
    <WidgetCard
      title={title}
      meta={t("widget.poller-pulse.meta", { count: interval })}
      conclusion={conclusion}
      tone={stalled ? "alarm" : undefined}
      className="@container"
    >
      <div className="flex items-center gap-2.5">
        <StatusDot status={stalled ? "major_outage" : "operational"} size={10} pulse={!stalled} />
        <span className="text-sm font-medium">{t(stalled ? "widget.poller-pulse.state-stalled" : "widget.poller-pulse.state-alive")}</span>
        {last !== null && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">{t("widget.poller-pulse.ago", { time: ago(last) })}</span>
        )}
      </div>

      <dl className="hidden grid-cols-3 gap-4 @md:grid">
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-xs text-muted-foreground uppercase">{t("widget.poller-pulse.last")}</dt>
          <dd className="font-mono text-lg">{last === null ? "—" : t("widget.poller-pulse.ago", { time: ago(last) })}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-xs text-muted-foreground uppercase">{t("widget.poller-pulse.next")}</dt>
          <dd className="font-mono text-lg">
            {next === null ? "—" : next <= now ? t("widget.poller-pulse.due") : t("widget.poller-pulse.in", { time: formatDuration(i18n.language, (next - now) / MINUTE) })}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-mono text-xs text-muted-foreground uppercase">{t("widget.poller-pulse.silent")}</dt>
          <dd className="font-mono text-lg" style={{ color: silent > 0 ? "var(--status-degraded)" : undefined }}>
            {silent > 0 ? (
              <DrillLink
                to={ROUTE_PATHS.providers}
                label={t("widget.poller-pulse.silent-label", { count: silent })}
                where={t("widget.poller-pulse.silent-where")}
              >
                {silent}
              </DrillLink>
            ) : (
              0
            )}
          </dd>
        </div>
      </dl>
    </WidgetCard>
  );
}
