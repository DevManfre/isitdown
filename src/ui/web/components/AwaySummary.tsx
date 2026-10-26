import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { DrillLink } from "@/components/DrillLink.tsx";
import {
  useDeliveryLog,
  useIncidents,
  useMaintenances,
  usePreferences,
  usePreferencesMutation,
  useStatus,
} from "@/hooks/queries.ts";
import { deliveryHref, incidentsHref } from "@/lib/drillDown.ts";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format.ts";
import { impactStatus } from "@/lib/incidents.ts";
import { cn } from "@/lib/utils.ts";
import type { IncidentRow, MaintenanceRow } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** Shorter than this and nobody needs the recap: a lunch break is not "away". */
export const AWAY_MIN_HOURS = 8;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Rows per column before the rest becomes a link. */
const SHOWN = 3;
/** The server's own page cap: the recap counts from one page, never paging. */
const PAGE = 100;
const COLLAPSED_KEY = "isitdown.awayCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* only costs the choice surviving a reload */
  }
}

const detailHref = (row: IncidentRow) =>
  ROUTE_PATHS.incidentDetail.replace(":providerId", row.providerId).replace(":incidentId", row.incidentId);

/**
 * "What changed while I was away" — roadmap 4.4.
 *
 * Opening the dashboard after a weekend, the operator gets one card above the
 * grid: what is still open, what came and went, what maintenance ran. "Seen"
 * writes the time into the instance's preferences, so another browser does not
 * replay it; collapsed or open is this browser's own choice.
 *
 * It never draws an empty card. A first visit has no "before" to recount, an
 * absence under eight hours is not one, and an absence nothing happened in has
 * nothing to say — in all three the last visit just moves to now, quietly.
 */
export function AwaySummary() {
  const { data: preferences } = usePreferences();
  const save = usePreferencesMutation();
  // Frozen at mount: the recap is about the visit that just started, and a
  // window that slid with the clock would quietly drop its oldest rows.
  const [now] = useState(() => Date.now());
  const moved = useRef(false);

  // Absent is a server older than the summary: say nothing and write nothing.
  const lastSeenAt = preferences?.lastSeenAt;
  const since = typeof lastSeenAt === "string" ? Date.parse(lastSeenAt) : null;
  const longEnough = since !== null && now - since >= AWAY_MIN_HOURS * HOUR;

  /** Moves the last visit forward, once per mount — whichever way it happens. */
  const markSeen = (at: number) => {
    if (moved.current) return;
    moved.current = true;
    save.mutate({ lastSeenAt: new Date(at).toISOString() });
  };

  // A first visit and a short absence have no recap to show, but they still
  // move the visit forward — quietly, and without asking for the rows at all.
  useEffect(() => {
    if (lastSeenAt === undefined || longEnough) return;
    markSeen(now);
  });

  if (since === null || !longEnough) return null;
  return <Recap since={since} now={now} onSeen={markSeen} />;
}

function Recap({ since, now, onSeen }: { since: number; now: number; onSeen: (at: number) => void }) {
  const { t, i18n } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [dismissed, setDismissed] = useState(false);
  const days = Math.max(1, Math.ceil((now - since) / DAY));

  const { data: status } = useStatus();
  const { data: incidents } = useIncidents({ state: "all", days, pageSize: PAGE });
  const { data: maintenances } = useMaintenances({ days, includeUpcoming: false, limit: PAGE });
  const { data: delivery } = useDeliveryLog({ pageSize: 200 });

  const loaded = incidents !== undefined && maintenances !== undefined;
  const within = (iso: string | null | undefined) => iso != null && Date.parse(iso) >= since && Date.parse(iso) <= now;
  // `days` filters on when an incident started, so one that began before the
  // absence and closed during it is not in this page: the recap covers what
  // started while the operator was away, plus everything still open now.
  const rows = (incidents?.page?.items ?? []).filter((row) => within(row.startedAt) || within(row.resolvedAt));
  const stillOpen = rows.filter((row) => row.resolvedAt === null);
  const resolved = rows.filter((row) => row.resolvedAt !== null);
  const ran = (maintenances?.maintenances ?? []).filter((m: MaintenanceRow) => within(m.startsAt));
  const sent = (delivery?.page?.items ?? []).filter((r) => within(r.sentAt));
  const failed = sent.filter((r) => !r.ok).length;
  const nothing = rows.length === 0 && ran.length === 0;

  // Nothing happened: no empty card, the visit just moves to now.
  useEffect(() => {
    if (loaded && nothing) onSeen(now);
  });

  if (dismissed || !loaded || nothing) return null;

  const name = (id: string) => status?.providers.find((p) => p.id === id)?.name ?? id;
  const sinceIso = new Date(since).toISOString();
  const sinceText = formatDateTime(i18n.language, sinceIso);
  const agoText = formatRelative(i18n.language, sinceIso);
  const alarm = stillOpen.length > 0;
  const toggle = () => {
    setCollapsed(!collapsed);
    rememberCollapsed(!collapsed);
  };
  const seenButton = (
    <Button
      type="button"
      size="sm"
      onClick={() => {
        onSeen(Date.now());
        setDismissed(true);
      }}
    >
      {t("away.seen")}
    </Button>
  );
  const tally = t("away.tally", { open: stillOpen.length, resolved: resolved.length, maintenance: ran.length });

  const row = (incident: IncidentRow) => {
    const state = incident.resolvedAt === null ? impactStatus(incident.impact) : "operational";
    const lasted =
      incident.resolvedAt === null
        ? t("away.open-for", { time: formatDuration(i18n.language, (now - Date.parse(incident.startedAt)) / 60_000) })
        : t("away.lasted", {
            time: formatDuration(i18n.language, (Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) / 60_000),
          });
    return (
      <li key={`${incident.providerId}/${incident.incidentId}`} className="border-t border-border">
        <Link to={detailHref(incident)} className="flex min-w-0 items-center gap-2.5 rounded-sm py-2 text-sm hover:text-primary">
          <StatusDot status={state} />
          <span className="truncate">
            {name(incident.providerId)} · {incident.name}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{lasted}</span>
        </Link>
      </li>
    );
  };

  const column = (
    heading: string,
    tone: string | undefined,
    items: IncidentRow[],
    more: { href: string; label: string },
  ) => (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-2 pb-1.5">
        <h3 className="font-mono text-xs tracking-wider uppercase" style={{ color: tone }}>
          {heading}
        </h3>
        {items.length > SHOWN && (
          <Link to={more.href} className="font-mono text-xs text-primary hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      <ul className="flex flex-col">{items.slice(0, SHOWN).map(row)}</ul>
    </div>
  );

  return (
    <Card
      data-slot="away-summary"
      aria-labelledby="away-title"
      role="region"
      className={cn(
        "anim-rise col-span-6 gap-4 px-5 py-4 shadow-none",
        alarm ? "border-primary/45 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="away-title" className="text-base font-medium">
            {t("away.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {collapsed ? tally : t("away.since", { since: sinceText, ago: agoText, tally })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seenButton}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={!collapsed}
            aria-label={t(collapsed ? "away.expand" : "away.collapse")}
            onClick={toggle}
          >
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {stillOpen.length > 0 &&
            column(t("away.open", { count: stillOpen.length }), "var(--status-major-outage)", stillOpen, {
              href: incidentsHref({ state: "active" }),
              label: t("away.all"),
            })}
          {resolved.length > 0 &&
            column(t("away.resolved", { count: resolved.length }), "var(--status-operational)", resolved, {
              href: incidentsHref({ state: "resolved", days }),
              label: t("away.more", { count: resolved.length - SHOWN }),
            })}
          {ran.length > 0 && (
            <div className="flex min-w-0 flex-col">
              <h3 className="pb-1.5 font-mono text-xs tracking-wider text-muted-foreground uppercase">
                {t("away.maintenance", { count: ran.length })}
              </h3>
              <ul className="flex flex-col">
                {ran.slice(0, SHOWN).map((m) => (
                  <li key={`${m.providerId}/${m.id}`} className="flex min-w-0 items-center gap-2.5 border-t border-border py-2 text-sm">
                    <StatusDot status="unknown" />
                    <span className="truncate">
                      {name(m.providerId)} · {m.name === "" ? t("away.maintenance-untitled") : m.name}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {formatRelative(i18n.language, m.startsAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sent.length > 0 && (
            <p className="font-mono text-xs text-muted-foreground md:col-span-3">
              {t("away.alerts", { count: sent.length })}{" "}
              {failed > 0 && (
                <DrillLink
                  to={deliveryHref({ state: "failed" })}
                  label={t("drill.where.delivery-failed")}
                  where={t("drill.where.delivery-failed")}
                  className="text-[var(--status-degraded)]"
                >
                  {t("away.failed", { count: failed })}
                </DrillLink>
              )}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
