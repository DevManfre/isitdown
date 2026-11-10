import { Check, Eye, Pencil, PenLine, Send, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatDateTime, formatDuration, formatTime } from "@/lib/format.ts";
import { impactKey } from "@/lib/incidents.ts";
import type { IncidentEvent } from "@/lib/incidentStory.ts";
import type { IncidentRevision, IncidentRow } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

/**
 * One sentence per field a provider can edit after the fact (roadmap 1.11).
 * Written out rather than built from the field name, so the catalog check can
 * see every key that is rendered.
 */
const REVISION_KEYS: Record<IncidentRevision["field"], string> = {
  impact: "incident.revisions.impact",
  started_at: "incident.revisions.started_at",
  resolved_at: "incident.revisions.resolved_at",
};

type Tone = "bad" | "good" | "plain" | "note";

function Node({ icon: Icon, tone, major }: { icon: LucideIcon; tone: Tone; major: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 grid shrink-0 place-items-center rounded-full",
        major ? "size-8 text-background" : "size-7",
        tone === "plain" && "bg-muted text-muted-foreground",
        tone === "note" && "bg-primary/20 text-primary",
      )}
      style={
        tone === "bad"
          ? { background: statusColor("major_outage"), boxShadow: `0 0 0 6px color-mix(in srgb, ${statusColor("major_outage")} 16%, transparent)` }
          : tone === "good"
            ? { background: statusColor("operational"), boxShadow: `0 0 0 6px color-mix(in srgb, ${statusColor("operational")} 16%, transparent)` }
            : undefined
      }
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/**
 * What happened, in one list: the incident's own milestones as big nodes, our
 * sends folded to one row per burst, the provider's later edits, and the
 * operator's notes between them. The note composer is the last entry, so
 * writing one reads as adding to the story rather than filling in a form.
 */
export function IncidentTimeline({
  events, incident, spansDays, draft, onDraft, onSave, saving, onRemoveNote, removing,
}: {
  events: IncidentEvent[];
  incident: IncidentRow;
  /** The incident ran past a day, so a bare clock time would be ambiguous. */
  spansDays: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onRemoveNote: (id: number) => void;
  removing: boolean;
}) {
  const { t, i18n } = useTranslation();
  const when = (iso: string): string => (spansDays ? formatDateTime(i18n.language, iso) : formatTime(i18n.language, iso));
  // An impact word the catalog knows reads translated; one it does not is the
  // provider's own, shown as written rather than as "Unknown → Unknown".
  const impactLabel = (word: string): string => (impactKey(word) === "status.unknown" ? word : t(impactKey(word)));

  return (
    <section aria-labelledby="incident-events" className="flex flex-col gap-5">
      <h3 id="incident-events" className="text-lg font-semibold tracking-tight">
        {t("incident.events.title")}
      </h3>

      <div className="flex flex-col gap-7 rounded-xl border border-border bg-card p-5 md:p-6">
      <ol className="flex flex-col">
        {events.map((event, index) => {
          const last = index === events.length - 1;
          let icon: LucideIcon = Eye;
          let tone: Tone = "plain";
          let major = false;
          let body: React.ReactNode;
          let key: string = event.type;

          if (event.type === "opened") {
            icon = TriangleAlert;
            tone = "bad";
            major = true;
            key = `opened-${event.at}`;
            body = (
              <>
                <span className="text-[17px] font-semibold">{t("incident.event.opened")}</span>
                <span className="text-sm text-muted-foreground">{t(impactKey(incident.impact))}</span>
                {event.declaredAt !== undefined && event.firstSeenAt !== undefined && (
                  <span className="text-sm text-muted-foreground">
                    {t("incident.event.declared", {
                      at: formatTime(i18n.language, event.declaredAt),
                      delay: formatDuration(
                        i18n.language,
                        Math.max(0, Date.parse(event.firstSeenAt) - Date.parse(event.declaredAt)) / 60_000,
                      ),
                    })}
                  </span>
                )}
              </>
            );
          } else if (event.type === "resolved") {
            icon = Check;
            tone = "good";
            major = true;
            key = `resolved-${event.at}`;
            body = (
              <>
                <span className="text-[17px] font-semibold">{t("incident.event.resolved")}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDuration(i18n.language, (Date.parse(event.at) - Date.parse(incident.startedAt)) / 60_000)}
                </span>
              </>
            );
          } else if (event.type === "observed") {
            key = `observed-${event.at}`;
            body = (
              <>
                <span className="text-[15px]">{t("incident.event.observed")}</span>
                <span className="text-sm text-muted-foreground">{t(statusLabelKey(event.status))}</span>
              </>
            );
          } else if (event.type === "sends") {
            icon = Send;
            key = `sends-${event.at}`;
            const { burst } = event;
            body = (
              <>
                <span className="text-[15px]">
                  {t("incident.event.sends", { count: burst.records.length })}
                  {burst.failed > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {t("incident.event.failed")}
                    </Badge>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("incident.event.sends-detail", { delivered: burst.delivered, failed: burst.failed })}
                </span>
                <details className="group mt-0.5">
                  <summary className="w-fit cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    {t("incident.event.channels")}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {burst.records.map((record, position) => (
                      <li key={`${record.channel}-${record.sentAt}-${position}`} className="flex flex-wrap gap-x-3">
                        <span className="min-w-20 font-medium">{record.channel}</span>
                        <span className={record.ok ? "text-muted-foreground" : "text-destructive"}>
                          {record.ok
                            ? `✓ ${t("incident.event.delivered")}`
                            : `✕ ${t("incident.event.failed")}${record.error === undefined ? "" : ` — ${record.error}`}`}
                        </span>
                        <span className="w-full font-mono text-xs text-muted-foreground">
                          {record.text.split("\n")[0]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            );
          } else if (event.type === "note") {
            icon = PenLine;
            tone = "note";
            key = `note-${event.note.id}`;
            body = (
              <>
                <span className="text-[15px]">{t("incident.event.note")}</span>
                {/* Whitespace kept: a note is written as sentences and often as
                    two of them, and collapsing the newlines would rewrite it. */}
                <blockquote className="mt-1 rounded-r-lg rounded-l-sm border border-l-[3px] border-border border-l-primary bg-background p-3.5 text-[14.5px] whitespace-pre-wrap">
                  {event.note.body}
                </blockquote>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit px-1 text-muted-foreground"
                  aria-label={t("incident.notes.remove")}
                  disabled={removing}
                  onClick={() => onRemoveNote(event.note.id)}
                >
                  {t("action.remove")}
                </Button>
              </>
            );
          } else {
            icon = Pencil;
            key = `revision-${event.revision.field}-${event.revision.after}`;
            const { revision } = event;
            body = (
              <>
                <span data-revision={revision.field} className="text-[15px]">
                  {t(REVISION_KEYS[revision.field], {
                    before: revision.field === "impact" ? impactLabel(revision.before) : formatDateTime(i18n.language, revision.before),
                    after: revision.field === "impact" ? impactLabel(revision.after) : formatDateTime(i18n.language, revision.after),
                  })}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("incident.revisions.noticed", { at: formatDateTime(i18n.language, revision.observedAt) })}
                </span>
              </>
            );
          }

          return (
            <li
              key={key}
              className={cn(
                "grid grid-cols-[48px_28px_minmax(0,1fr)] gap-x-2 md:grid-cols-[64px_32px_minmax(0,1fr)] md:gap-x-3",
                !last && "pb-7",
              )}
            >
              <time dateTime={event.at} className="pt-1 text-right font-mono text-xs text-muted-foreground">
                {when(event.at)}
              </time>
              <span className="relative flex justify-center">
                <Node icon={icon} tone={tone} major={major} />
                {/* The rail runs between nodes and stops at the last one. */}
                {!last && <span aria-hidden="true" className="absolute top-8 -bottom-7 w-0.5 rounded-full bg-border" />}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">{body}</div>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-[48px_28px_minmax(0,1fr)] gap-x-2 border-t border-border pt-6 md:grid-cols-[64px_32px_minmax(0,1fr)] md:gap-x-3">
        <span />
        <span className="flex justify-center">
          <Node icon={PenLine} tone="plain" major={false} />
        </span>
        <div className="flex flex-col gap-2.5">
          <label htmlFor="incident-note" className="text-sm font-medium">
            {t("incident.notes.add")}
          </label>
          <Textarea
            id="incident-note"
            value={draft}
            maxLength={2000}
            rows={3}
            placeholder={t("incident.notes.placeholder")}
            onChange={(event) => onDraft(event.target.value)}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">{t("incident.notes.hint")}</span>
            <Button type="button" disabled={draft.trim() === "" || saving} onClick={onSave}>
              {t("incident.notes.add")}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
