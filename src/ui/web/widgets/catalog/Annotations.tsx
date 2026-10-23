import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useAnnotations, useIncidents } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { annotationColour } from "@/lib/chartConfig.ts";
import { impactFill } from "@/lib/incidents.ts";
import { stagger } from "@/lib/stagger.ts";
import type { Annotation, IncidentRow } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { DAY, MINUTE, useNames } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

const DAYS = 7;
/** An incident starting this soon after a marker is worth putting next to it. */
const LINK_MINUTES = 60;

/**
 * The operator's own markers — deploys, migrations — on the same seven days as
 * the incidents, so "was it our release or theirs?" is answered by where two
 * things sit on one line. A marker followed within the hour by an incident
 * says so in words, too.
 */
export function Annotations() {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE);
  const name = useNames();
  const { data } = useAnnotations({ days: DAYS });
  const { data: incidents } = useIncidents({ days: DAYS, pageSize: 100 });
  const title = t("dashboard.widget.annotations.title");
  const meta = t("widget.annotations.meta", { days: DAYS });
  if (data === undefined) return <WidgetCard title={title} busy />;

  const markers = [...data.annotations].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const recent: IncidentRow[] = markers.length === 0 ? [] : (incidents?.page.items ?? []);
  const after = (marker: Annotation) =>
    recent
      .filter((row) => {
        const gap = (Date.parse(row.startedAt) - Date.parse(marker.at)) / MINUTE;
        return gap >= 0 && gap <= LINK_MINUTES;
      })
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  if (markers.length === 0) {
    return (
      <WidgetCard title={title} meta={meta}>
        <p className="text-sm text-muted-foreground">{t("widget.annotations.none", { days: DAYS })}</p>
        <Link to={ROUTE_PATHS.history} className="text-sm text-primary hover:underline">
          {t("widget.annotations.add")}
        </Link>
      </WidgetCard>
    );
  }

  const linked = markers.map((m) => ({ marker: m, incident: after(m) })).filter((x) => x.incident !== undefined);
  // Whether an incident followed a marker is a claim about incidents: none is
  // made until they have loaded.
  const conclusion =
    incidents === undefined
      ? undefined
      : linked.length === 0
      ? t("widget.annotations.unlinked", { count: markers.length })
      : t("widget.annotations.linked", {
          provider: name(linked[0]!.incident!.providerId),
          minutes: Math.round((Date.parse(linked[0]!.incident!.startedAt) - Date.parse(linked[0]!.marker.at)) / MINUTE),
          label: linked[0]!.marker.label,
        });
  const start = now - DAYS * DAY;
  const at = (ms: number) => `${Math.max(0, Math.min(100, ((ms - start) / (DAYS * DAY)) * 100))}%`;
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric" });

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} className="@container">
      {/* A third: the latest marker. */}
      <div className="flex flex-col gap-1.5 @md:hidden">
        <span className="flex items-center gap-2 text-[0.95rem] font-medium">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: annotationColour(markers[0]!.colour) }} />
          {markers[0]!.label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{when(markers[0]!.at)}</span>
      </div>

      {/* Half: the list, each marker with what followed it. */}
      <ul className="hidden flex-col gap-2.5 @md:flex @2xl:hidden" aria-hidden="true">
        {markers.slice(0, 6).map((marker, index) => {
          const next = after(marker);
          return (
            <li key={marker.id} className="anim-rise anim-rise-row flex flex-col gap-0.5" style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}>
              <span className="flex min-w-0 items-center gap-2.5 text-sm">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: annotationColour(marker.colour) }} />
                <span className="min-w-0 flex-1 truncate">{marker.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{when(marker.at)}</span>
              </span>
              {incidents !== undefined && next !== undefined && (
                <span className="pl-4.5 font-mono text-xs" style={{ color: impactFill(next.impact) }}>
                  {t("widget.annotations.followed", {
                    minutes: Math.round((Date.parse(next.startedAt) - Date.parse(marker.at)) / MINUTE),
                    provider: name(next.providerId),
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Full: one line, incidents above and markers below. */}
      <ul className="sr-only">
        {markers.map((marker) => {
          const next = incidents === undefined ? undefined : after(marker);
          return (
            <li key={marker.id}>
              {marker.label} · {when(marker.at)}
              {next !== undefined &&
                ` · ${t("widget.annotations.followed", { minutes: Math.round((Date.parse(next.startedAt) - Date.parse(marker.at)) / MINUTE), provider: name(next.providerId) })}`}
            </li>
          );
        })}
      </ul>
      <div className="hidden @2xl:block" aria-hidden="true">
        <div className="relative mb-1 flex justify-between font-mono text-[0.65rem] text-muted-foreground">
          {Array.from({ length: DAYS + 1 }, (_, i) => (
            <span key={i}>{i === DAYS ? t("widget.maintenances.today") : day.format(new Date(start + i * DAY))}</span>
          ))}
        </div>
        <div className="relative h-20 border-t border-border">
          {recent.map((row, index) => (
            <span
              key={`${row.providerId}/${row.incidentId}`}
              className="anim-fill absolute -top-2 h-3 origin-left rounded-sm"
              style={{
                left: at(Date.parse(row.startedAt)),
                width: `max(4px, calc(${at(row.resolvedAt === null ? now : Date.parse(row.resolvedAt))} - ${at(Date.parse(row.startedAt))}))`,
                background: impactFill(row.impact),
                animationDelay: stagger(index, { base: 160, step: 40 }),
              }}
            />
          ))}
          {markers.map((marker, index) => (
            <div key={marker.id} className="absolute top-0 flex flex-col items-start" style={{ left: at(Date.parse(marker.at)) }}>
              <span className="anim-stem h-5 w-0.5" style={{ background: annotationColour(marker.colour), animationDelay: stagger(index, { base: 320, step: 70 }) }} />
              <span
                className="anim-fade max-w-36 truncate font-mono text-[0.7rem]"
                style={{ animationDelay: stagger(index, { base: 420, step: 70 }), transform: Date.parse(marker.at) > now - DAY ? "translateX(-100%)" : undefined }}
              >
                {marker.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}
