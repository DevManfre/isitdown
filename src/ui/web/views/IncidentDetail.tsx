import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Trans, useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { BentoTile } from "@/components/BentoTile.tsx";
import { IncidentMap } from "@/components/IncidentMap.tsx";
import { PollStrip } from "@/components/charts/PollStrip.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useIncident, useStatus } from "@/hooks/queries.ts";
import { formatDateTime, formatDuration, formatTime } from "@/lib/format.ts";
import {
  impactColor, impactKey, impactStatus, incidentStatusKey, INCIDENT_STEPS,
} from "@/lib/incidents.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** The lifecycle words, widened for `.indexOf` against the incident's own (plain string) status. */
const STEPS: readonly string[] = INCIDENT_STEPS;

/** How long the copy-payload confirmation stays up — incident.js:238. */
const TOAST_MS = 2500;

/** The tiles enter in reading order, after the hero and the stepper have landed. */
const TILE_CASCADE = { base: 240, step: 60 };

const durationSince = (locale: string, from: string): string =>
  formatDuration(locale, (Date.now() - Date.parse(from)) / 60_000);

const durationBetween = (locale: string, from: string, to: string): string =>
  formatDuration(locale, (Date.parse(to) - Date.parse(from)) / 60_000);

/**
 * Design 3a's incident detail: the status stepper, the timeline of what
 * IsItDown observed, the action log of what it actually sent, the
 * provider's other open incidents, the strip of recent polls, and where the
 * provider physically runs.
 *
 * Laid out as a bento of uniform tiles on the same `BentoTile` Settings uses —
 * the blocks below used to be bare labelled stacks in a `2fr_1fr` split, which
 * gave the page two competing column rhythms and no shared tile shape. The hero
 * and the stepper stay full-width bands above the grid: both are read left to
 * right across the whole page, and boxing them would break that.
 *
 * The timeline is our own observations, not the provider's update feed — the
 * adapter does not normalise those, and inventing them would be worse than
 * showing less. Straight port of src/ui/public/js/views/incident.js.
 */
export function IncidentDetail() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const providerId = params["providerId"] ?? "";
  const incidentId = params["incidentId"] ?? "";
  const { data: detail } = useIncident(providerId, incidentId);
  const { data: status } = useStatus();

  const [copiedMessage, setCopiedMessage] = useState<string | undefined>(undefined);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    if (toastTimeout.current !== undefined) clearTimeout(toastTimeout.current);
  }, []);

  const nameOf = (id: string): string => status?.providers.find((provider) => provider.id === id)?.name ?? id;

  // useIncident throws on an initial-load failure (routes.tsx's errorElement
  // catches it); while it is still in flight there is nothing to render yet.
  if (detail === undefined) return null;

  const { incident, timeline, actionLog, polls, otherActiveIncidents } = detail;
  const reached = incident.resolvedAt === null ? STEPS.indexOf(incident.status) : STEPS.length - 1;

  const elapsed =
    incident.resolvedAt === null
      ? t("incident.elapsed", { duration: durationSince(i18n.language, incident.startedAt) })
      : t("incident.closed-after", {
          duration: durationBetween(i18n.language, incident.startedAt, incident.resolvedAt),
        });

  const copyPayload = async (): Promise<void> => {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
    setCopiedMessage(t("incident.payload-copied"));
    if (toastTimeout.current !== undefined) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setCopiedMessage(undefined), TOAST_MS);
  };

  const first = polls.at(-1);
  const last = polls[0];

  return (
    <div className="flex flex-col gap-6">
      {/* incident.js:36-43 — navigates to #/overview, not #/incidents: the
          catalog string itself is "Back to overview". */}
      <Link
        to={ROUTE_PATHS.overview}
        className="back-link mono flex w-fit items-center gap-1 text-sm text-muted-foreground"
      >
        <span aria-hidden="true">←</span>
        {t("action.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="anim-rise flex items-center gap-2" style={{ animationDelay: "40ms" }}>
            <span className="text-xs uppercase tracking-widest" style={{ color: impactColor(incident.impact) }}>
              {t("incident.kicker")}
            </span>
            <Badge variant="outline" style={{ color: impactColor(incident.impact), borderColor: impactColor(incident.impact) }}>
              {t(impactKey(incident.impact))}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{incident.incidentId}</span>
          </div>

          <h2
            className="anim-rise anim-rise-hero max-w-[26ch] text-3xl font-medium tracking-tight"
            style={{ animationDelay: "100ms" }}
          >
            {incident.name}
          </h2>

          <span
            className="anim-rise anim-rise-hero font-mono text-sm text-muted-foreground"
            style={{ animationDelay: "160ms" }}
          >
            {nameOf(incident.providerId)} · {elapsed}
          </span>
        </div>

        <div className="anim-rise anim-rise-column flex flex-col items-end gap-1" style={{ animationDelay: "200ms" }}>
          <Button type="button" variant="ghost" className="mono" onClick={() => void copyPayload()}>
            {t("action.copy-payload")}
          </Button>
          {copiedMessage !== undefined && (
            <span role="status" className="text-xs text-muted-foreground">
              {copiedMessage}
            </span>
          )}
        </div>
      </div>

      <div className="stepper flex flex-wrap items-center gap-6">
        {INCIDENT_STEPS.map((step, index) => {
          const active = index <= reached;
          const isReached = index === reached;
          const stillOpen = isReached && incident.resolvedAt === null;
          return (
            <div
              key={step}
              className="anim-fade flex items-center gap-2"
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <StatusDot status={active ? impactStatus(incident.impact) : "unknown"} size={9} pulse={stillOpen} />
              <span
                className={cn("font-mono text-[11px]", isReached ? "font-medium" : "font-normal", !active && "text-muted-foreground")}
                style={active ? { color: impactColor(incident.impact) } : undefined}
                aria-current={isReached ? "step" : undefined}
              >
                {t(incidentStatusKey(step))}
              </span>
              <span
                className="anim-sweep anim-sweep-step h-px w-10 bg-border"
                style={{ animationDelay: `${index * 90}ms` }}
              />
            </div>
          );
        })}
      </div>

      {/* Six columns, same grid as Settings: what IsItDown observed and what it
          sent share the top row, the poll strip and the current status the
          middle one, the provider's other incidents and its geography the last.
          The map is the only tile that can be absent (the operator's `mapView`
          preference is off by default), which is why it is placed last — its
          absence leaves the trailing edge of the grid short rather than a hole
          in the middle of the page. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <BentoTile
          title={t("incident.timeline")}
          delay={stagger(0, TILE_CASCADE)}
          className="md:col-span-2"
        >
          {timeline.map((entry, index) => (
            <div
              key={`${entry.at}-${entry.label}`}
              className="anim-rise grid grid-cols-[70px_1fr] gap-3"
              style={{ animationDelay: stagger(index, { base: 170, step: 38, cap: 420 }) }}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {formatTime(i18n.language, entry.at)}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  {t(`incident.timeline.${entry.label}`)}
                </span>
                {entry.status !== undefined && <span className="text-sm">{t(incidentStatusKey(entry.status))}</span>}
              </div>
            </div>
          ))}
        </BentoTile>

        {/* The one tinted tile: what IsItDown *did* is the only block on this
            page that is about us rather than the provider, and the tint is what
            told them apart before every block became a tile. */}
        <BentoTile
          title={t("incident.what-we-did")}
          delay={stagger(1, TILE_CASCADE)}
          className="border-primary/40 bg-primary/5 md:col-span-4"
        >
          {actionLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("incidents.empty-notifications")}</p>
          ) : (
            actionLog.map((record, index) => (
              <div
                key={`${record.providerId}-${record.sentAt}-${index}`}
                className="anim-fade grid grid-cols-[70px_1fr] items-baseline gap-3"
                style={{ animationDelay: stagger(index, { base: 200, step: 30, cap: 420 }) }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTime(i18n.language, record.sentAt)}
                </span>
                <span className="font-mono text-[11px]">
                  <span>{record.channel}</span>
                  {": "}
                  <span>{record.text.split("\n")[0]}</span>
                  {!record.ok && record.error !== undefined && (
                    <span className="text-destructive"> — {record.error}</span>
                  )}
                </span>
              </div>
            ))
          )}
        </BentoTile>

        <BentoTile
          title={
            <Trans
              i18nKey="incident.last-polls"
              count={polls.length}
              values={{ count: polls.length }}
              components={[<NumberTicker locale={i18n.language} value={polls.length} />]}
            />
          }
          note={
            first !== undefined && last !== undefined ? (
              <span className="font-mono">
                {formatTime(i18n.language, first.observedAt)} → {formatTime(i18n.language, last.observedAt)} ·{" "}
                {nameOf(incident.providerId)}
              </span>
            ) : undefined
          }
          delay={stagger(2, TILE_CASCADE)}
          className="md:col-span-4"
        >
          <PollStrip samples={polls} />
        </BentoTile>

        <BentoTile
          title={t("column.status")}
          delay={stagger(3, TILE_CASCADE)}
          className="md:col-span-2"
        >
          {/* incident.js:214-221 — .service-row with exactly two children:
              a bare status span and a "mono muted" timestamp span. Kept
              verbatim; a Testing Library query that collided with the
              stepper's own label is a defect in the query, not a reason
              to reshape this row (see IncidentDetail.test.tsx). */}
          <div
            className="service-row anim-rise anim-rise-row flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            style={{ animationDelay: "200ms" }}
          >
            <span className="text-sm">{t(incidentStatusKey(incident.status))}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatDateTime(i18n.language, incident.updatedAt)}
            </span>
          </div>
        </BentoTile>

        {/* `self-start`, alone on this page: this is the one tile whose row
            partner is the map, which is as tall as its own 2:1 aspect makes it.
            Stretching a two-word empty state ("None.") to 430px is the hole the
            grid was supposed to remove. */}
        <BentoTile
          title={t("incident.other-active")}
          delay={stagger(4, TILE_CASCADE)}
          className="md:col-span-3 md:self-start"
        >
          {otherActiveIncidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("incident.no-other-active")}</p>
          ) : (
            otherActiveIncidents.map((other, index) => (
              <Link
                key={`${other.providerId}/${other.incidentId}`}
                to={`/incidents/${other.providerId}/${other.incidentId}`}
                className="service-row anim-rise anim-rise-row flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                style={{ animationDelay: stagger(index, { base: 160, step: 32, cap: 420 }) }}
              >
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot status={impactStatus(other.impact)} />
                  {other.name}
                </span>
                <span className="font-mono text-[10.5px]" style={{ color: impactColor(other.impact) }}>
                  {t(incidentStatusKey(other.status))}
                </span>
              </Link>
            ))
          )}
        </BentoTile>

        <IncidentMap
          providerId={incident.providerId}
          providerName={nameOf(incident.providerId)}
          delay={stagger(5, TILE_CASCADE)}
          className="md:col-span-3"
        />
      </div>
    </div>
  );
}
