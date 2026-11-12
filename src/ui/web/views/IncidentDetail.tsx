import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { IncidentMap } from "@/components/IncidentMap.tsx";
import { IncidentHero } from "@/components/incident/IncidentHero.tsx";
import { IncidentTimeline } from "@/components/incident/IncidentTimeline.tsx";
import { IncidentSummaryBlock } from "@/components/incident/IncidentSummaryBlock.tsx";
import { PollStrip } from "@/components/charts/PollStrip.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { ViewSkeleton } from "@/components/ViewSkeleton.tsx";
import { useIncident, useIncidentFollow, useIncidentNotes, usePreferences, useStatus } from "@/hooks/queries.ts";
import { formatDateTime, formatDuration } from "@/lib/format.ts";
import { impactColor, impactStatus, incidentStatusKey } from "@/lib/incidents.ts";
import { buildEvents, lifeline, verdictOf } from "@/lib/incidentStory.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** How long the copy-payload confirmation stays up. */
const TOAST_MS = 2500;

/**
 * The incident page, read in three levels.
 *
 * 1. The verdict (`IncidentHero`): one sentence saying whether it is over and
 *    still matters, the figures behind it, and the incident drawn over time.
 *    Most visits stop there.
 * 2. What happened (`IncidentTimeline`): one list of our observations, what we
 *    sent, the provider's later edits and the operator's notes.
 * 3. Context, in a quiet column: how the provider reads right now, the facts,
 *    its other open incidents, and — behind a disclosure — the map. Anything
 *    empty is absent rather than drawn as an empty card.
 *
 * The timeline is our own observations, not the provider's update feed — the
 * adapter does not normalise those, and inventing them would be worse than
 * showing less.
 */
export function IncidentDetail() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const providerId = params["providerId"] ?? "";
  const incidentId = params["incidentId"] ?? "";
  const { data: detail } = useIncident(providerId, incidentId);
  const { data: status } = useStatus();
  const mapOn = (usePreferences().data?.mapView ?? "off") !== "off";

  const [copiedMessage, setCopiedMessage] = useState<string | undefined>(undefined);
  // Roadmap 5.3. Held here rather than in the timeline: it is rendered from
  // the detail query, and a draft must survive the refetch an added note causes.
  const [draft, setDraft] = useState("");
  const [mapOpen, setMapOpen] = useState(false);
  const notesMutations = useIncidentNotes(providerId, incidentId);
  const follow = useIncidentFollow(providerId, incidentId);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (toastTimeout.current !== undefined) clearTimeout(toastTimeout.current);
  }, []);

  const nameOf = (id: string): string => status?.providers.find((provider) => provider.id === id)?.name ?? id;

  // The server stamps `now` into nothing, so the figures that depend on it are
  // computed here, once per payload rather than on every render.
  const story = useMemo(() => {
    if (detail === undefined) return undefined;
    const nowMs = Date.now();
    const { incident, polls, actionLog, notes, timeline } = detail;
    return {
      verdict: verdictOf({ incident, polls, actionLog, nowMs }),
      line: lifeline({ incident, polls, actionLog, notes, nowMs }),
      events: buildEvents({ incident, timeline, actionLog, notes, revisions: detail.revisions ?? [] }),
    };
  }, [detail]);

  // useIncident throws on an initial-load failure (routes.tsx's errorElement
  // catches it); while it is still in flight the page's own shape stands in.
  if (detail === undefined || story === undefined) return <ViewSkeleton hero rows={4} />;

  const { incident, polls, otherActiveIncidents } = detail;
  const providerName = nameOf(incident.providerId);
  const open = incident.resolvedAt === null;
  const spansDays = Date.parse(story.line.toIso) - Date.parse(story.line.fromIso) > 24 * 3_600_000;

  const copyPayload = async (): Promise<void> => {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
    setCopiedMessage(t("incident.payload-copied"));
    if (toastTimeout.current !== undefined) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setCopiedMessage(undefined), TOAST_MS);
  };

  const saveNote = (): void => {
    const body = draft.trim();
    if (body === "") return;
    notesMutations.add.mutate(body, { onSuccess: () => setDraft("") });
  };

  const facts: [string, string][] = [
    [t("incident.stat.started"), formatDateTime(i18n.language, incident.startedAt)],
    ...(incident.declaredAt === undefined
      ? []
      : ([[t("incident.facts.declared"), formatDateTime(i18n.language, incident.declaredAt)]] as [string, string][])),
    ...(open
      ? ([[t("column.status"), t(incidentStatusKey(incident.status))]] as [string, string][])
      : ([[t("incident.facts.resolved"), formatDateTime(i18n.language, incident.resolvedAt ?? "")]] as [string, string][])),
  ];

  return (
    <div className="flex flex-col gap-10">
      {/* Navigates to the overview, not the incident list: the catalog string
          itself is "Back to overview". */}
      <Link
        to={ROUTE_PATHS.overview}
        className="back-link mono flex w-fit items-center gap-1 text-sm text-muted-foreground"
      >
        <span aria-hidden="true">←</span>
        {t("action.back")}
      </Link>

      <IncidentHero
        detail={detail}
        providerName={providerName}
        verdict={story.verdict}
        line={story.line}
        follow={{
          pending: follow.isPending,
          error: follow.isError ? (follow.error instanceof Error ? follow.error.message : String(follow.error)) : undefined,
          onToggle: () => follow.mutate(detail.followed !== true),
        }}
        onCopyPayload={() => void copyPayload()}
        copied={copiedMessage}
      />

      <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1fr)_300px] md:gap-12">
        <IncidentTimeline
          events={story.events}
          incident={incident}
          spansDays={spansDays}
          draft={draft}
          onDraft={setDraft}
          onSave={saveNote}
          saving={notesMutations.add.isPending}
          onRemoveNote={(id) => notesMutations.remove.mutate(id)}
          removing={notesMutations.remove.isPending}
        />

        <aside aria-label={t("incident.facts.title")} className="flex flex-col gap-8 md:pt-[52px]">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t("incident.now.title", { provider: providerName })}
            </h3>
            <PollStrip samples={polls} />
            <p className="text-sm text-muted-foreground">{t("incident.now.caption", { count: Math.min(polls.length, 24) })}</p>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">{t("incident.facts.title")}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            {incident.cost !== undefined && incident.cost !== null && (
              <p className="text-sm text-muted-foreground">
                {t("incident.facts.cost-note", {
                  duration: formatDuration(
                    i18n.language,
                    (Date.parse(story.line.toIso) - Date.parse(incident.startedAt)) / 60_000,
                  ),
                  provider: providerName,
                })}
              </p>
            )}
          </section>

          {/* Roadmap 6.10. After the facts, not before: the observed state and
              the numbers are the page's job, and the model's sentence is a
              reading of them — opt-in, absent while AI is off. */}
          <IncidentSummaryBlock providerId={incident.providerId} incidentId={incident.incidentId} />

          {/* Only when there is something to list: an empty "none" on every
              incident is noise, and a provider with no other open incident is
              the normal case. */}
          {otherActiveIncidents.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">{t("incident.other-active")}</h3>
              <ul className="flex flex-col gap-2">
                {otherActiveIncidents.map((other) => (
                  <li key={`${other.providerId}/${other.incidentId}`}>
                    <Link
                      to={`/incidents/${other.providerId}/${other.incidentId}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusDot status={impactStatus(other.impact)} />
                        <span className="truncate">{other.name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs" style={{ color: impactColor(other.impact) }}>
                        {t(incidentStatusKey(other.status))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The map is the one block behind a disclosure, and is only offered
              while the operator's `mapView` preference is on. Closed, it asks
              the server for nothing: Radix leaves the content unmounted. */}
          {mapOn && (
            <Collapsible open={mapOpen} onOpenChange={setMapOpen}>
              <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between border-y border-border text-sm text-muted-foreground hover:text-foreground">
                {t("incident.map.show")}
                <ChevronDown aria-hidden="true" className="size-4 transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <IncidentMap
                  providerId={incident.providerId}
                  providerName={providerName}
                  delay="0ms"
                  className=""
                />
              </CollapsibleContent>
            </Collapsible>
          )}
        </aside>
      </div>
    </div>
  );
}
