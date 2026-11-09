import { useTranslation } from "react-i18next";
import { statusFill } from "@/lib/chartConfig.ts";
import { formatDateTime } from "@/lib/format.ts";
import type { Lifeline, MarkerKind, Reading } from "@/lib/incidentStory.ts";
import { cn } from "@/lib/utils.ts";

/** What each slice of the line is drawn in: the same status fills every other chart uses. */
const READING_FILL: Record<Exclude<Reading, "none">, string> = {
  ok: statusFill("operational"),
  degraded: statusFill("degraded"),
  down: statusFill("major_outage"),
};

const READING_LABEL: Record<Exclude<Reading, "none">, string> = {
  ok: "status.operational",
  degraded: "status.degraded",
  down: "incident.life.down",
};

const MARKER_CLASS: Record<MarkerKind, string> = {
  opened: "size-3.5 border-[3px] border-destructive bg-card",
  alert: "size-2.5 border-2 border-primary bg-card",
  failed: "size-2.5 border-2 border-destructive bg-destructive",
  note: "size-2.5 border-2 border-primary bg-primary",
  resolved: "size-3.5 border-[3px] border-[var(--status-operational)] bg-card",
  now: "size-3 border-2 border-foreground bg-foreground",
};

/**
 * The incident drawn as a shape over time — one slice per stretch of its life,
 * coloured by the worst thing our own polls read in it, with every send and
 * note placed along it.
 *
 * The line is a picture of what the timeline below says in words, so it is one
 * image to a screen reader: the sentence under the heading, not 48 slices and a
 * dozen pins. The legend only names what is actually drawn, and never leaves a
 * colour to mean something on its own.
 */
export function IncidentLifeline({ line }: { line: Lifeline }) {
  const { t, i18n } = useTranslation();
  const present = new Set(line.segments);
  const kinds = new Set(line.markers.map((marker) => marker.kind));
  const entries: { color: string; label: string }[] = [
    ...(["down", "degraded", "ok"] as const)
      .filter((reading) => present.has(reading))
      .map((reading) => ({ color: READING_FILL[reading], label: t(READING_LABEL[reading]) })),
    ...(present.has("none") ? [{ color: "var(--muted)", label: t("incident.life.unmeasured") }] : []),
    ...(kinds.has("alert") || kinds.has("note")
      ? [{ color: "var(--primary)", label: t("incident.life.alert") }]
      : []),
    ...(kinds.has("failed") ? [{ color: "var(--destructive)", label: t("incident.life.failed") }] : []),
  ];

  const from = formatDateTime(i18n.language, line.fromIso);
  const to = formatDateTime(i18n.language, line.toIso);

  return (
    <div className="flex flex-col gap-3" data-testid="incident-lifeline">
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>{from}</span>
        <span>{t(line.open ? "incident.life.now" : "incident.life.resolved", { at: to })}</span>
      </div>
      <div
        role="img"
        aria-label={`${t("incident.life.label")}: ${from} → ${to}`}
        className="relative h-9"
      >
        <div className="absolute inset-x-0 top-3 flex h-3 gap-0.5" aria-hidden="true">
          {line.segments.map((reading, index) => (
            <span
              // Slices are positional and never reorder.
              key={index}
              data-reading={reading}
              className={cn("h-full flex-1 rounded-[3px]", reading === "none" && "bg-muted")}
              style={reading === "none" ? undefined : { background: READING_FILL[reading] }}
            />
          ))}
        </div>
        {line.markers.map((marker, index) => (
          <span
            key={index}
            aria-hidden="true"
            data-marker={marker.kind}
            className={cn(
              "absolute top-0 box-border -translate-x-1/2 rounded-full",
              MARKER_CLASS[marker.kind],
              marker.kind === "now" && "dot-pulse",
            )}
            style={{ left: `${marker.pct}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {entries.map((entry) => (
          <li key={entry.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: entry.color }} />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
