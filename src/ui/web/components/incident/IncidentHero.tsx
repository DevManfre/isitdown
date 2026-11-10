import { Check, Info, MoreHorizontal, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { IncidentLifeline } from "@/components/incident/IncidentLifeline.tsx";
import { statusColor } from "@/lib/chartConfig.ts";
import { formatDuration } from "@/lib/format.ts";
import { impactColor, impactKey, impactStatus, incidentStatusKey } from "@/lib/incidents.ts";
import type { Lifeline, Verdict } from "@/lib/incidentStory.ts";
import type { IncidentDetail } from "@/lib/types.ts";

/**
 * The top of the incident page, and the only part most visits need: what it is,
 * whether it is over and still matters (one sentence), the four figures behind
 * that sentence, and the incident drawn over time.
 *
 * Tinted by the incident's impact while it is open and by "operational" once it
 * is resolved — the one place status colour fills a surface. Every colour here
 * is also said in words (the badge, the verdict, the legend).
 */
export function IncidentHero({
  detail, providerName, verdict, line, follow, onCopyPayload, copied,
}: {
  detail: IncidentDetail;
  providerName: string;
  verdict: Verdict;
  line: Lifeline;
  follow: { pending: boolean; error: string | undefined; onToggle: () => void };
  onCopyPayload: () => void;
  copied: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { incident, actionLog } = detail;
  const open = incident.resolvedAt === null;
  const tone = open ? impactColor(incident.impact) : statusColor("operational");
  const failed = actionLog.filter((record) => !record.ok).length;
  const minutes = (from: string, to: number): number => Math.max(0, (to - Date.parse(from)) / 60_000);

  const Icon = verdict.kind === "resolved" ? Check : verdict.kind === "recovered" ? Info : TriangleAlert;
  const title =
    verdict.kind === "resolved"
      ? t("incident.verdict.resolved.title", { duration: formatDuration(i18n.language, verdict.minutes) })
      : verdict.kind === "recovered"
        ? t("incident.verdict.recovered.title", { provider: providerName })
        : t("incident.verdict.active.title", { provider: providerName });
  const detailText =
    verdict.kind === "recovered"
      ? t("incident.verdict.recovered.detail", { count: verdict.operationalPolls, provider: providerName })
      : verdict.failed > 0
        ? t("incident.verdict.detail.failed", { count: verdict.failed })
        : verdict.sent === 0
          ? t("incident.verdict.detail.none")
          : verdict.kind === "resolved"
            ? t("incident.verdict.detail.delivered", { count: verdict.sent })
            : undefined;

  const stats = [
    {
      id: "elapsed",
      label: t(open ? "incident.stat.open-for" : "incident.stat.closed-in"),
      value: formatDuration(
        i18n.language,
        open
          ? minutes(incident.startedAt, Date.now())
          : minutes(incident.startedAt, Date.parse(incident.resolvedAt ?? incident.startedAt)),
      ),
    },
    ...(incident.declaredAt !== undefined && incident.firstSeenAt !== undefined
      ? [
          {
            // Roadmap 1.1: how long the page said it before we read it.
            id: "detected",
            label: t("incident.stat.detected"),
            value: formatDuration(
              i18n.language,
              Math.max(0, Date.parse(incident.firstSeenAt) - Date.parse(incident.declaredAt)) / 60_000,
            ),
            note: t("incident.stat.detected-note"),
          },
        ]
      : []),
    {
      id: "notified",
      label: t("incident.stat.notified"),
      value: String(actionLog.length),
      note: t("incident.stat.notified-note", { count: failed }),
      alert: failed > 0,
    },
    // Roadmap 6.3: only with a declared hourly rate; an undeclared one is not a free outage.
    ...(incident.cost !== undefined && incident.cost !== null
      ? [
          {
            id: "cost",
            label: t("incident.stat.cost"),
            value: new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
              incident.cost,
            ),
          },
        ]
      : []),
  ];

  return (
    <section
      aria-labelledby="incident-title"
      className="flex flex-col gap-7 rounded-2xl border border-border bg-card p-5 md:p-8"
      style={{
        backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, ${tone} 14%, transparent), transparent 55%)`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="text-foreground">{providerName}</span>
          <Badge variant="outline" style={{ color: tone, borderColor: tone }} className="gap-2">
            <StatusDot status={open ? impactStatus(incident.impact) : "operational"} size={8} pulse={open} />
            {t(impactKey(incident.impact))} · {t(incidentStatusKey(incident.status))}
          </Badge>
          <span className="font-mono text-xs">{incident.incidentId}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Roadmap 3.6. Only on an open incident: a resolved one has no update
              left to send, and the server refuses to follow it. */}
          {open && (
            <>
              <Button
                type="button"
                variant={detail.followed === true ? "secondary" : "default"}
                aria-pressed={detail.followed === true}
                aria-describedby="incident-follow-hint"
                disabled={follow.pending}
                onClick={follow.onToggle}
              >
                {t(detail.followed === true ? "incident.following" : "incident.follow")}
              </Button>
              <span id="incident-follow-hint" className="sr-only">
                {t("incident.follow.hint")}
              </span>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label={t("incident.menu.label")}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Roadmap 6.4. A plain download, same as the export links: the server writes the document. */}
              <DropdownMenuItem asChild>
                <a
                  href={`/incidents/${encodeURIComponent(incident.providerId)}/${encodeURIComponent(incident.incidentId)}/postmortem.md`}
                  download
                >
                  {t("action.download-postmortem")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCopyPayload}>{t("action.copy-payload")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {follow.error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {t("incident.follow.failed", { reason: follow.error })}
        </p>
      )}
      {copied !== undefined && (
        <p role="status" className="text-sm text-muted-foreground">
          {copied}
        </p>
      )}

      <h2 id="incident-title" className="max-w-[26ch] text-3xl font-semibold tracking-tight text-balance md:text-[32px]">
        {incident.name}
      </h2>

      <div role="status" className="flex max-w-[62ch] items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full"
          style={{ color: tone, background: `color-mix(in srgb, ${tone} 18%, transparent)` }}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex flex-col gap-0.5">
          <strong className="text-base font-semibold">{title}</strong>
          {detailText !== undefined && <span className="text-sm text-muted-foreground">{detailText}</span>}
        </div>
      </div>

      <div
        data-slot="incident-stats"
        data-testid="incident-stats"
        className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-border pt-6 md:grid-cols-[repeat(auto-fit,minmax(0,1fr))] md:gap-0 md:divide-x md:divide-border"
      >
        {stats.map((stat) => (
          <div key={stat.id} data-stat={stat.id} className="flex flex-col gap-1 md:px-6 md:first:pl-0 md:last:pr-0">
            <span className={`font-mono text-2xl leading-tight font-semibold md:text-[28px] ${"alert" in stat && stat.alert === true ? "text-destructive" : ""}`}>
              {stat.value}
            </span>
            <span className="text-sm text-muted-foreground">{stat.label}</span>
            {"note" in stat && stat.note !== undefined && (
              <span className="text-xs text-muted-foreground">{stat.note}</span>
            )}
          </div>
        ))}
      </div>

      <IncidentLifeline line={line} />
    </section>
  );
}
