import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useConfigChrome, useDeliveryLog } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatRelative } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { SentRecord } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { MINUTE } from "./shared.ts";
import { LoadFailed, WidgetCard } from "./WidgetCard.tsx";

const HOURS = 24;
const HOUR = 60 * MINUTE;

type Slot = "none" | "ok" | "retried" | "failed";
const SLOT_FILL: Record<Slot, string> = {
  none: "var(--muted)",
  ok: "var(--status-operational-fill)",
  retried: "var(--status-degraded-fill)",
  failed: "var(--status-major-outage-fill)",
};
const SLOT_KEY: Record<Slot, string> = {
  none: "widget.delivery.slot.none",
  ok: "widget.delivery.slot.ok",
  retried: "widget.delivery.slot.retried",
  failed: "widget.delivery.slot.failed",
};
const slotOf = (sent: readonly SentRecord[]): Slot =>
  sent.length === 0 ? "none" : sent.some((r) => !r.ok) ? "failed" : sent.some((r) => (r.attempts ?? 1) > 1) ? "retried" : "ok";

/**
 * Whether the alerts actually arrived, per channel, hour by hour over the last
 * day. IsItDown watching providers is half the job; this is the other half,
 * and a channel that quietly started failing at 3 a.m. shows as one red square.
 */
export function Delivery() {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE);
  const { data } = useDeliveryLog({ pageSize: 200 });
  const { data: config, isError: configFailed, refetch } = useConfigChrome();
  const title = t("dashboard.widget.delivery.title");
  // Which channels exist comes from the configuration: until it is here, "no
  // channel is on" would be a guess, and a wrong one is a false alarm.
  if (configFailed) return <LoadFailed title={title} retry={() => void refetch()} />;
  if (data === undefined || config === undefined) return <WidgetCard title={title} busy />;

  const enabled = config.channels.filter((c) => c.enabled).map((c) => c.id);
  const since = now - HOURS * HOUR;
  const day = data.page.items.filter((r) => Date.parse(r.sentAt) >= since);
  const channels = [...new Set([...enabled, ...day.map((r) => r.channel)])];
  const channelName = (id: string) => t(`channel.name.${id}`, { defaultValue: id });

  if (channels.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.delivery.no-channels")}</p>
        <Link to={ROUTE_PATHS.settings} className="text-sm text-primary hover:underline">
          {t("widget.delivery.configure")}
        </Link>
      </WidgetCard>
    );
  }

  const failed = day.filter((r) => !r.ok);
  const meta = t("widget.delivery.meta", { sent: day.length, failed: failed.length });
  const rows = channels.map((channel) => {
    const own = day.filter((r) => r.channel === channel);
    const hours = Array.from({ length: HOURS }, (_, h) => {
      const from = since + h * HOUR;
      return slotOf(own.filter((r) => {
        const at = Date.parse(r.sentAt);
        return at >= from && at < from + HOUR;
      }));
    });
    const lastFailure = own.filter((r) => !r.ok).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0];
    const retried = own.filter((r) => r.ok && (r.attempts ?? 1) > 1).length;
    return { channel, sent: own.length, failed: own.filter((r) => !r.ok).length, retried, hours, lastFailure };
  });
  const broken = rows.filter((r) => r.failed > 0);
  const conclusion =
    broken.length === 0
      ? t("widget.delivery.all-arrived", { count: day.length })
      : t("widget.delivery.lost", {
          channel: channelName(broken[0]!.channel),
          since: formatRelative(i18n.language, broken[0]!.lastFailure!.sentAt),
          error: broken[0]!.lastFailure!.error ?? "",
        });
  const rate = day.length === 0 ? null : (day.length - failed.length) / day.length;

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} tone={broken.length > 0 ? "warn" : undefined} className="@container">
      {/* A third: the share that arrived. */}
      <div className="flex flex-col gap-1 @md:hidden">
        <span className="font-mono text-3xl">
          {rate === null ? "—" : new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 }).format(rate)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{t("widget.delivery.share", { ok: day.length - failed.length, total: day.length })}</span>
      </div>

      {/* Half: per channel, its state in words. */}
      <ul className="hidden flex-col gap-2 @md:flex @2xl:hidden">
        {rows.map((row) => (
          <li key={row.channel} className="flex items-center gap-2.5 text-sm">
            <StatusDot status={row.failed > 0 ? "major_outage" : row.sent > 0 ? "operational" : "unknown"} />
            <span className="flex-1 truncate">{channelName(row.channel)}</span>
            <span className="font-mono text-xs" style={{ color: row.failed > 0 ? "var(--status-major-outage)" : undefined }}>
              {row.failed > 0 ? t("widget.delivery.row-failed", { count: row.failed }) : t("widget.delivery.row-sent", { count: row.sent })}
            </span>
          </li>
        ))}
      </ul>

      {/* Full: an hour per square. */}
      <div className="hidden grid-cols-[7rem_minmax(0,1fr)_6rem] items-center gap-x-4 gap-y-2.5 @2xl:grid">
        <span />
        <span className="flex justify-between font-mono text-[0.65rem] text-muted-foreground">
          <span>{t("widget.delivery.hours-ago", { count: HOURS })}</span>
          <span>{t("widget.delivery.hours-ago", { count: HOURS / 2 })}</span>
          <span>{t("widget.delivery.now")}</span>
        </span>
        <span />
        {rows.map((row, r) => (
          <div key={row.channel} className="contents">
            <span className="truncate text-sm">{channelName(row.channel)}</span>
            <div
              className="anim-row-sweep grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5"
              style={{ animationDelay: stagger(r, { base: 140, step: 70 }) }}
              role="img" aria-label={t("widget.delivery.row-label", { channel: channelName(row.channel), sent: row.sent, retried: row.retried, failed: row.failed })}>
              {row.hours.map((slot, h) => (
                <span key={h} title={t(SLOT_KEY[slot])} className="h-4 rounded-[2px]" style={{ background: SLOT_FILL[slot] }} />
              ))}
            </div>
            <span className="text-right font-mono text-xs" style={{ color: row.failed > 0 ? "var(--status-major-outage)" : undefined }}>
              {row.sent} · {t("widget.delivery.ko", { count: row.failed })}
            </span>
          </div>
        ))}
      </div>
      <div className="hidden flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground @2xl:flex">
        {(Object.keys(SLOT_FILL) as Slot[]).map((slot) => (
          <span key={slot} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: SLOT_FILL[slot] }} />
            {t(SLOT_KEY[slot])}
          </span>
        ))}
      </div>
    </WidgetCard>
  );
}
