import type { Annotation, IncidentNote, IncidentRow } from "./historyStore.interface.ts";
import type { IncidentRevision } from "./incidentRevisions.ts";
import { duration } from "./monthlyReport.ts";
import type { SentRecord } from "../core/notificationDispatcher.ts";

/**
 * The document somebody writes by hand the morning after — roadmap 6.4. One
 * Markdown file per incident, assembled from what IsItDown already holds:
 * our own observations, the provider's later edits, what we sent and to which
 * channel, the operator's notes, the markers on the timeline, and whatever else
 * was down at the same time.
 *
 * Pure: the route gathers the rows and this decides how they read, as with the
 * monthly report. English, deliberately not a catalog key — a postmortem is
 * pasted into a wiki or a ticket, not rendered by the dashboard.
 */

export interface PostmortemTimelineEntry {
  at: string;
  label: string;
  status?: string | undefined;
}

export interface OverlappingIncident {
  providerName: string;
  name: string;
  startedAt: string;
  /** `null` while it is still open. */
  resolvedAt: string | null;
}

export interface PostmortemInput {
  providerName: string;
  incident: IncidentRow;
  /** The estimated cost of the incident, or `null` when no hourly rate was declared. */
  cost: number | null;
  timeline: PostmortemTimelineEntry[];
  revisions: IncidentRevision[];
  notifications: SentRecord[];
  notes: IncidentNote[];
  annotations: Annotation[];
  overlapping: OverlappingIncident[];
  generatedAt: string;
}

/** A string placed inside a line of Markdown: its pipes escaped and its newlines folded away. */
const inline = (text: string): string => text.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");

/** A Mermaid task name cannot hold the characters that end it early. */
const taskName = (text: string): string => text.replace(/[:;#\n]/g, " ").trim();

/** Mermaid's `gantt` date format `YYYY-MM-DDTHH:mm`, UTC. */
const ganttTime = (iso: string): string => iso.slice(0, 16);

const FIELD_LABEL: Record<IncidentRevision["field"], string> = {
  impact: "impact",
  started_at: "start time",
  resolved_at: "resolution time",
};

interface Entry {
  at: string;
  text: string;
}

export function renderPostmortem(input: PostmortemInput): string {
  const { incident } = input;
  const end = incident.resolvedAt ?? input.generatedAt;
  const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(incident.startedAt)) / 60_000));

  const lines: string[] = [];
  lines.push(`# Postmortem — ${inline(incident.name)}`);
  lines.push("");
  lines.push(`- **Provider:** ${inline(input.providerName)}`);
  lines.push(`- **Impact:** ${inline(incident.impact)}`);
  lines.push(`- **Started:** ${incident.startedAt}`);
  lines.push(`- **Resolved:** ${incident.resolvedAt ?? "still open"}`);
  lines.push(`- **Duration:** ${duration(minutes)}${incident.resolvedAt === null ? " so far" : ""}`);
  if (input.cost !== null) lines.push(`- **Estimated cost:** ${input.cost.toFixed(2)}`);
  lines.push("");

  const entries: Entry[] = [];
  for (const entry of input.timeline) {
    const status = entry.status === undefined ? "" : ` (${inline(entry.status)})`;
    const text =
      entry.label === "opened"
        ? `Incident opened${status}`
        : entry.label === "resolved"
          ? "Incident resolved"
          : `Status observed${status}`;
    entries.push({ at: entry.at, text });
  }
  for (const revision of input.revisions) {
    entries.push({
      at: revision.observedAt,
      text: `The provider's ${FIELD_LABEL[revision.field]} changed from ${inline(revision.before)} to ${inline(revision.after)} (noticed by IsItDown, not necessarily when it was edited)`,
    });
  }
  for (const record of input.notifications) {
    entries.push({
      at: record.sentAt,
      text: `Notified ${inline(record.channel)} — ${record.ok ? "delivered" : "failed"}: ${inline(record.text)}`,
    });
  }
  for (const note of input.notes) entries.push({ at: note.createdAt, text: `Operator note: ${inline(note.body)}` });
  for (const annotation of input.annotations) {
    entries.push({
      at: annotation.at,
      text: `Marker${annotation.providerId === null ? " (whole fleet)" : ""}: ${inline(annotation.label)}`,
    });
  }
  // Stable for entries at the same instant: the order they were gathered in
  // reads opened-before-notified, which is the order they happened in.
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  lines.push("## Timeline");
  lines.push("");
  lines.push("All times UTC.");
  lines.push("");
  for (const entry of entries) lines.push(`- \`${entry.at}\` — ${entry.text}`);
  lines.push("");

  if (input.overlapping.length > 0) {
    lines.push("## Providers down at the same time");
    lines.push("");
    lines.push("Incidents on other providers whose window overlaps this one. Overlap is not cause.");
    lines.push("");
    lines.push("| Provider | Incident | Started | Resolved |");
    lines.push("|---|---|---|---|");
    for (const other of input.overlapping) {
      lines.push(
        `| ${inline(other.providerName)} | ${inline(other.name)} | ${other.startedAt} | ${other.resolvedAt ?? "still open"} |`,
      );
    }
    lines.push("");
    lines.push("```mermaid");
    lines.push("gantt");
    lines.push("  dateFormat YYYY-MM-DDTHH:mm");
    lines.push("  axisFormat %d %H:%M");
    lines.push("  section This incident");
    lines.push(`  ${taskName(input.providerName)} :crit, ${ganttTime(incident.startedAt)}, ${ganttTime(end)}`);
    lines.push("  section Overlapping");
    for (const other of input.overlapping) {
      lines.push(
        `  ${taskName(other.providerName)} :${ganttTime(other.startedAt)}, ${ganttTime(other.resolvedAt ?? input.generatedAt)}`,
      );
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated by IsItDown on ${input.generatedAt}. The timeline is what IsItDown observed and sent, not the provider's own update feed; a postmortem still needs the cause and what changes because of it, which only the people involved can write.`,
  );
  lines.push("");
  return lines.join("\n");
}
