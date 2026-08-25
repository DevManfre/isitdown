import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useIncidents, useNotifications, useStatus } from "@/hooks/queries.ts";
import { formatDateTime, formatRelative } from "@/lib/format.ts";
import { impactKey, impactStatus, incidentStatusKey } from "@/lib/incidents.ts";
import { cn } from "@/lib/utils.ts";
import type { IncidentRow } from "@/lib/types.ts";

/** How many recent notifications the feed panel shows — incidents.js:43. */
const NOTIFICATIONS_SHOWN = 8;

const FILTERS = [
  { value: "all", labelKey: "filter.all" },
  { value: "active", labelKey: "filter.active" },
  { value: "resolved", labelKey: "filter.resolved" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];

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
 * Design 3a's Incidents view: filter row, accent-tinted active incident card
 * beside the notifications-sent panel, closed-incident list.
 *
 * Every section keeps its own keyed empty state — a blank panel reads as a
 * broken page, not as good news. Straight port of
 * src/ui/public/js/views/incidents.js, with the DOM class sweep the vanilla
 * filter used replaced by React state (that sweep is what regressed in
 * `3d447c5`).
 */
export function Incidents() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>(readFilter);
  const { data: incidents } = useIncidents();
  const { data: status } = useStatus();
  const { data: sent } = useNotifications(NOTIFICATIONS_SHOWN);

  const nameOf = (providerId: string): string =>
    status?.providers.find((provider) => provider.id === providerId)?.name ?? providerId;

  const active = incidents?.active ?? [];
  const closed = incidents?.closed ?? [];
  const counts = { all: active.length + closed.length, active: active.length, resolved: closed.length };

  // The filter is a view of data already in hand — switching it repaints
  // these two sections rather than re-fetching, same as incidents.js:46-47.
  const showActive = filter !== "resolved";
  const showClosed = filter !== "active";

  const goTo = (incident: IncidentRow): void => {
    void navigate(`/incidents/${incident.providerId}/${incident.incidentId}`);
  };

  const [current, ...otherActive] = active;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {t("incidents.filter.label")}
        </span>
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
                {counts[entry.value]}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

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
          {(sent?.notifications ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("incidents.empty-notifications")}</p>
          ) : (
            (sent?.notifications ?? []).map((record, index) => (
              <div
                key={`${record.providerId}-${record.sentAt}-${index}`}
                className="anim-fade flex items-baseline gap-2 border-t border-border pt-1"
                style={{ animationDelay: `${index * 65}ms` }}
              >
                <StatusDot status={record.ok ? "operational" : "major_outage"} size={6} />
                <span className="flex min-w-0 flex-col">
                  {/* The stored text is what was actually delivered — the
                      first line only here, same as incidents.js:195. */}
                  <span className="text-xs">{record.text.split("\n")[0]}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {record.channel} · {formatDateTime(i18n.language, record.sentAt)} · {nameOf(record.providerId)}
                  </span>
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      {showClosed && (
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("incidents.closed")}</span>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("incidents.empty-closed")}</p>
          ) : (
            closed.map((incident, index) => (
              <button
                key={`${incident.providerId}/${incident.incidentId}`}
                type="button"
                className="incident-row anim-rise anim-rise-row flex items-center gap-3 rounded-md border border-border px-3 py-2 text-left"
                style={{ animationDelay: `${index * 70}ms` }}
                onClick={() => goTo(incident)}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(i18n.language, incident.startedAt)}
                </span>
                <StatusDot status={impactStatus(incident.impact)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    <span>{nameOf(incident.providerId)}</span> — <span>{incident.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("incidents.impact-line", {
                      impact: t(impactKey(incident.impact)),
                      status: t(incidentStatusKey(incident.status)),
                    })}
                  </span>
                </span>
                <span className="ml-auto rounded border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {t("incident.status.resolved")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
