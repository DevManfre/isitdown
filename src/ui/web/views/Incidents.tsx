import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";
import { useIncidents, useMaintenances, useNotifications, useStatus } from "@/hooks/queries.ts";
import { formatDateTime, formatRelative, notificationHeadline } from "@/lib/format.ts";
import { impactKey, impactStatus, incidentStatusKey, pageWindow } from "@/lib/incidents.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import type { IncidentRow, MaintenanceRow } from "@/lib/types.ts";

/** How many recent notifications the feed panel shows — incidents.js:43. */
const NOTIFICATIONS_SHOWN = 8;
/** How many of those show before the operator asks for the rest. */
const NOTIFICATIONS_COLLAPSED = 2;
/** Rows per page of the incident list. The server caps anything larger. */
const PAGE_SIZE = 20;

const FILTERS = [
  { value: "all", labelKey: "filter.all" },
  { value: "active", labelKey: "filter.active" },
  { value: "resolved", labelKey: "filter.resolved" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

/** One row of the merged timeline: an incident the list already knew, or a declared maintenance window. */
type TimelineListEntry =
  | { kind: "incident"; at: string; incident: IncidentRow }
  | { kind: "maintenance"; at: string; maintenance: MaintenanceRow };

/** Chosen filter survives reload, the way the rail's collapsed state does. */
const FILTER_STORAGE_KEY = "isitdown.incidentFilter";

function readFilter(): Filter {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    return FILTERS.some((entry) => entry.value === stored) ? (stored as Filter) : "all";
  } catch {
    return "all";
  }
}

function rememberFilter(filter: Filter): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, filter);
  } catch {
    /* only costs the choice surviving a reload */
  }
}

/**
 * Design 3a's Incidents view: an accent-tinted active incident card beside the
 * notifications-sent panel, then the incident list — one page of it, with the
 * filter on the list's own header.
 *
 * Both the filter and the pager are server-side, and they have to be: a page of
 * 20 rows filtered in the browser would filter that page and report the result
 * as the whole list. So the filter is part of the query rather than the DOM
 * class sweep the vanilla view did (src/ui/public/js/views/incidents.js — that
 * sweep is what regressed in `3d447c5`), and the pill counts and the row total
 * come from the server, which is the only thing that can see past the page.
 *
 * Every section keeps its own keyed empty state — a blank panel reads as a
 * broken page, not as good news.
 */
export function Incidents() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>(readFilter);
  // The feed opens at two rows: it sits beside the active-incident card, and a
  // full eight of them stretched that column far past it. The rest stay one
  // click away rather than on another screen.
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const { data: incidents } = useIncidents({ state: filter, page, pageSize: PAGE_SIZE });
  const { data: maintenances } = useMaintenances();
  const { data: status } = useStatus();
  const { data: sent } = useNotifications(NOTIFICATIONS_SHOWN);

  const nameOf = (providerId: string): string =>
    status?.providers.find((provider) => provider.id === providerId)?.name ?? providerId;
  const baseUrlOf = (providerId: string): string =>
    status?.providers.find((provider) => provider.id === providerId)?.baseUrl ?? "";

  const active = incidents?.active ?? [];
  const rows = incidents?.page.items ?? [];
  // Maintenance rides along on the first page only: `useMaintenances()` fetches
  // the whole set, unpaged, and the pager below counts incidents alone (the
  // server-side `pages`/`total` never learn about maintenance rows). Merging
  // the full set into every page would repeat the same windows on page 2, 3,
  // ... and could push a page past PAGE_SIZE rows. Page 1 is where a newest-
  // first list reads "what's going on right now" anyway, so that is the one
  // page maintenance belongs on.
  const maintenanceRows = page === 1 ? (maintenances?.maintenances ?? []) : [];
  // The current page's incidents plus every declared maintenance window,
  // interleaved by when each started — newest first, same order the
  // incident-only list already read in. Maintenance carries no incident
  // state, so it rides along under every filter rather than vanishing
  // the moment an operator narrows to "active" or "resolved".
  const timelineEntries: TimelineListEntry[] = [
    ...rows.map((incident) => ({ kind: "incident" as const, at: incident.startedAt, incident })),
    ...maintenanceRows.map((maintenance) => ({ kind: "maintenance" as const, at: maintenance.startsAt, maintenance })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // Every state's count, from the server: the page holds at most PAGE_SIZE rows,
  // so counting the ones in hand would put the page size on the pills.
  const counts = incidents?.counts ?? { all: 0, active: 0, resolved: 0 };
  const total = incidents?.page.total ?? 0;
  // The server's own page size, not the one asked for: it caps the parameter, so
  // paging by what was requested would count pages that don't exist.
  const pages = Math.ceil(total / (incidents?.page.pageSize ?? PAGE_SIZE));

  // A poll can prune the list under an operator sitting on its last page (and a
  // remembered filter can be restored beside a page number that no longer
  // exists); an out-of-range page has no rows to show and would stay empty.
  useEffect(() => {
    if (pages > 0 && page > pages) setPage(pages);
  }, [page, pages]);

  // The filter now narrows the query, not a list already in hand: a paged list
  // cannot be filtered client-side without filtering one page of it and
  // reporting that as the whole result.
  const showActive = filter !== "resolved";

  const notifications = sent?.notifications ?? [];
  const shownNotifications = feedExpanded
    ? notifications
    : notifications.slice(0, NOTIFICATIONS_COLLAPSED);

  const goTo = (incident: IncidentRow): void => {
    void navigate(`/incidents/${incident.providerId}/${incident.incidentId}`);
  };

  const [current, ...otherActive] = active;

  // Its own node, rendered inside the list's header below rather than at the top
  // of the page. `aria-label` carries the name the visible kicker used to, now
  // that the list's own heading sits right beside the control.
  const filterControl = (
    <ToggleGroup
      type="single"
      value={filter}
      onValueChange={(next) => {
        // Same guarded pattern as readFilter() above: check membership
        // at runtime before narrowing, rather than a bare cast.
        if (!FILTERS.some((entry) => entry.value === next)) return;
        const picked = next as Filter;
        setFilter(picked);
        rememberFilter(picked);
        setPage(1);
      }}
      aria-label={t("incidents.filter.label")}
    >
      {FILTERS.map((entry) => (
        <ToggleGroupItem key={entry.value} value={entry.value}>
          {t(entry.labelKey)}
          {/* aria-hidden because a decorative count doesn't belong in a
              control's spoken name (vanilla's equivalent span,
              incidents.js:86, has no such attribute and so does include
              the count) — a real a11y improvement, not just query
              convenience. Incidents.test.tsx scopes its radio queries
              by a name-matcher function rather than depending on this
              attribute, so removing it later would not break the test. */}
          <span aria-hidden="true" className="ml-1.5 text-[10px] text-muted-foreground">
            <NumberTicker locale={i18n.language} value={counts[entry.value]} />
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className={cn("grid grid-cols-1 gap-6", showActive && "lg:grid-cols-[2fr_1fr]")}>
        {showActive && (
          <Card className="anim-rise flex flex-col gap-3 border-primary/40 bg-primary/5 p-4" style={{ animationDelay: "60ms" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-primary">{t("incidents.active")}</span>
              {current !== undefined && (
                <span className="font-mono text-xs text-muted-foreground">
                  {current.incidentId} · {formatRelative(i18n.language, current.startedAt)}
                </span>
              )}
            </div>

            {current === undefined ? (
              <p className="text-sm text-muted-foreground">{t("incidents.empty-active")}</p>
            ) : (
              <>
                {/* The name gets its own leaf node, separate from the
                    provider name it is paired with — a test asserting the
                    exact incident name (never concatenated with anything
                    else) must find a node whose own text is exactly that
                    name, not "Provider — Name" as one string. */}
                <span className="text-base font-medium">
                  <span>{nameOf(current.providerId)}</span> — <span>{current.name}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("incidents.impact-line", {
                    impact: t(impactKey(current.impact)),
                    status: t(incidentStatusKey(current.status)),
                  })}
                </span>
                <div>
                  <Button type="button" onClick={() => goTo(current)}>
                    {t("action.incident-details")}
                  </Button>
                </div>

                {otherActive.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {otherActive.map((incident) => (
                      <Button
                        key={`${incident.providerId}/${incident.incidentId}`}
                        type="button"
                        variant="ghost"
                        className="justify-start"
                        onClick={() => goTo(incident)}
                      >
                        <span>{nameOf(incident.providerId)}</span> — <span>{incident.name}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        <Card className="anim-rise panel-channel flex flex-col gap-3 p-4" style={{ animationDelay: "140ms" }}>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {t("incidents.notifications-sent")}
          </span>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("incidents.empty-notifications")}</p>
          ) : (
            shownNotifications.map((record, index) => (
              <div
                key={`${record.providerId}-${record.sentAt}-${index}`}
                className="anim-fade flex items-baseline gap-2 border-t border-border pt-1"
                style={{ animationDelay: stagger(index, { base: 150, step: 28, cap: 400 }) }}
              >
                <ProviderIcon
                  name={nameOf(record.providerId)}
                  baseUrl={baseUrlOf(record.providerId)}
                  className="translate-y-0.5"
                />
                <span className="flex min-w-0 flex-col">
                  {/* The stored text is what was actually delivered — the
                      first line only here, same as incidents.js:195, minus the
                      leading status emoji the provider icon now stands in for. */}
                  <span className="text-xs">{notificationHeadline(record.text)}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {record.channel} · {formatDateTime(i18n.language, record.sentAt)} · {nameOf(record.providerId)}
                  </span>
                </span>
              </div>
            ))
          )}
          {/* One control, and only while it has something to reveal: expanding
              is one-way, so the panel never grows a second "show less" twin. */}
          {!feedExpanded && notifications.length > NOTIFICATIONS_COLLAPSED && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start px-0 text-xs text-muted-foreground"
              onClick={() => setFeedExpanded(true)}
            >
              {t("action.show-more")}
            </Button>
          )}
        </Card>
      </div>

      {/* A named region, so a row query can be scoped to the list: the open
          incident is deliberately in two places at once — the hero card above
          and a row here, since the list holds every state under `all`. */}
      <section aria-label={t("incidents.list")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("incidents.list")}</span>
          {/* The filter sits on the list it filters, rather than at the top of
              the page, two sections away from its own effect. */}
          {filterControl}
        </div>

        {timelineEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("incidents.empty-list")}</p>
        ) : (
          timelineEntries.map((entry, index) =>
            entry.kind === "incident" ? (
              <button
                key={`${entry.incident.providerId}/${entry.incident.incidentId}`}
                type="button"
                className="incident-row anim-rise anim-rise-row flex items-center gap-3 rounded-md border border-border px-3 py-2 text-left"
                style={{ animationDelay: stagger(index, { base: 170, step: 32, cap: 420 }) }}
                onClick={() => goTo(entry.incident)}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(i18n.language, entry.incident.startedAt)}
                </span>
                <StatusDot status={impactStatus(entry.incident.impact)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    <span>{nameOf(entry.incident.providerId)}</span> — <span>{entry.incident.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("incidents.impact-line", {
                      impact: t(impactKey(entry.incident.impact)),
                      status: t(incidentStatusKey(entry.incident.status)),
                    })}
                  </span>
                </span>
                <span className="ml-auto rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {t(entry.incident.resolvedAt === null ? "incidents.state.open" : "incidents.state.resolved")}
                </span>
              </button>
            ) : (
              // Not a `<button>`: a maintenance window has no detail route to
              // navigate to, unlike an incident row alongside it.
              <div
                key={`${entry.maintenance.providerId}/${entry.maintenance.id}`}
                className="incident-row anim-rise anim-rise-row flex items-center gap-3 rounded-md border border-border px-3 py-2 text-left"
                style={{ animationDelay: stagger(index, { base: 170, step: 32, cap: 420 }) }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(i18n.language, entry.maintenance.startsAt)}
                </span>
                <Badge variant="muted">{t("incidents.maintenance.label")}</Badge>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    <span>{nameOf(entry.maintenance.providerId)}</span> — <span>{entry.maintenance.name}</span>
                  </span>
                </span>
              </div>
            ),
          )
        )}

        {pages > 1 && (
          // Pinned to the bottom of the viewport while the list runs past it,
          // settling back into flow at the end of the list — the pager is only
          // useful where the rows are, and a list 20 rows long is taller than
          // the screen. `sticky` rather than `fixed`: the bar stays inside the
          // list's own column without having to know the rail's width, and a
          // list that fits on one screen gets no floating bar (nor any bar at
          // all — `pages > 1`). Translucent with a blur because it does overlay
          // the rows it is pinned over; opaque would need the page's own
          // gradient, which only the body carries.
          <div className="sticky bottom-2 z-10 mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/95 px-3 py-2 backdrop-blur-md">
            <span className="font-mono text-xs text-muted-foreground">{t("incidents.total", { count: total })}</span>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={page === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  />
                </PaginationItem>
                {pageWindow(page, pages).map((slot, index) => (
                  <PaginationItem key={slot === "gap" ? `gap-${index}` : slot}>
                    {slot === "gap" ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink isActive={slot === page} onClick={() => setPage(slot)}>
                        {slot}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    disabled={page === pages}
                    onClick={() => setPage((current) => Math.min(pages, current + 1))}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </section>
    </div>
  );
}
