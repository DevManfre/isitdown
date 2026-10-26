import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useNotifications } from "@/hooks/queries.ts";
import { formatTime } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const SHOWN = 6;

/**
 * What the phone actually received — widget 20. The last few messages, the
 * channel each went out on and whether it landed, with the delivery log one
 * click away for the payloads.
 */
export function RecentAlerts() {
  const { t, i18n } = useTranslation();
  const { data } = useNotifications(SHOWN);
  const title = t("dashboard.widget.recent-alerts.title");
  if (data === undefined) return <WidgetCard title={title} busy />;

  const rows = data.notifications.slice(0, SHOWN);
  const channelName = (id: string) => t(`channel.name.${id}`, { defaultValue: id });
  const logLink = (
    <Link to={ROUTE_PATHS.deliveryLog} className="text-primary hover:underline">
      {t("widget.recent-alerts.log")}
    </Link>
  );

  if (rows.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.recent-alerts.none")}</p>
        <Link to={ROUTE_PATHS.settings} className="text-sm text-primary hover:underline">
          {t("widget.recent-alerts.test")}
        </Link>
      </WidgetCard>
    );
  }

  const latest = rows[0]!;
  const sameMoment = rows.filter((r) => r.sentAt === latest.sentAt);

  return (
    <WidgetCard title={title} meta={logLink} className="@container">
      {/* A third: the last message, and where it landed. */}
      <div className="flex flex-col gap-1.5 @md:hidden">
        <span className="font-mono text-xs text-muted-foreground">{formatTime(i18n.language, latest.sentAt)}</span>
        <span className="line-clamp-2 text-sm">{latest.text.split("\n")[0]}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {sameMoment
            .map((r) => `${channelName(r.channel)} ${r.ok ? t("widget.recent-alerts.ok-mark") : t("widget.recent-alerts.ko-mark")}`)
            .join(" · ")}
        </span>
      </div>

      <ul className="hidden flex-col @md:flex">
        {rows.map((row, index) => (
          <li
            key={`${row.sentAt}/${row.channel}/${index}`}
            className="anim-rise anim-rise-row flex min-w-0 items-center gap-2.5 border-t border-border py-2.5 text-sm"
            style={{ animationDelay: stagger(index, { base: 120, step: 40 }) }}
          >
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{formatTime(i18n.language, row.sentAt)}</span>
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">{channelName(row.channel)}</span>
            <span className="min-w-0 truncate">{row.text.split("\n")[0]}</span>
            <span
              className="ml-auto shrink-0 font-mono text-[0.68rem] tracking-wider uppercase"
              style={{ color: row.ok ? "var(--status-operational)" : "var(--status-major-outage)" }}
            >
              {row.ok
                ? t("widget.recent-alerts.delivered")
                : t("widget.recent-alerts.failed", { count: row.attempts ?? 1 })}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
