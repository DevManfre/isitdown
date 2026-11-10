import type { IncidentRow, SampleRow } from "./historyStore.interface.ts";
import type { MonthlyProviderReport } from "./history.ts";
import { duration, monthTitle, percent } from "./monthlyReport.ts";

/**
 * Evidence for an SLA credit claim — roadmap 6.5.
 *
 * The budget card (4.13) says a vendor missed what it promised; a credit
 * request has to show it. What a vendor's support desk asks for is always the
 * same: the windows, to the minute, the incidents on their own status page
 * that line up with them, and the arithmetic from those minutes to the
 * percentage. This file turns one provider's month into exactly that.
 *
 * The windows are rebuilt from the raw polls, one run of non-operational
 * readings each, and counted on the same rule the uptime figure is — one poll
 * is one interval — so the minutes in the table add up to the downtime in the
 * summary. Where retention has already folded the raw polls into daily
 * rollups (roadmap 6.1) the windows cannot be rebuilt, and the document says
 * how much is missing rather than presenting a partial list as the whole one.
 *
 * Pure, and English, for the reasons the monthly report is (see
 * `monthlyReport.ts`): the route gathers the rows, and the result is pasted
 * into a vendor's support form, not rendered by the dashboard.
 */

export interface DowntimeWindow {
  /** The first non-operational poll. */
  startedAt: string;
  /** The first operational poll after it, or `null` when the run reaches the end of what was polled. */
  endedAt: string | null;
  /** Polls in the run times the interval — the arithmetic the uptime figure uses. */
  minutes: number;
  /** The worst status read during the window. */
  worstStatus: string;
  /** Incidents on the provider's own page open at any point during the window. */
  incidentIds: string[];
}

export interface SlaEvidence {
  providerId: string;
  providerName: string;
  statusPage: string;
  month: string;
  from: string;
  to: string;
  partial: boolean;
  target: number;
  uptime: number | null;
  /** Measured uptime is below the target. `false` when nothing was measured. */
  belowTarget: boolean;
  intervalMinutes: number;
  /** Downtime the target allows over the whole month, in minutes. */
  allowedMinutes: number;
  downtimeMinutes: number;
  /** Polls behind the uptime figure, and how many of them are still held raw. */
  sampleCount: number;
  rawSampleCount: number;
  windows: DowntimeWindow[];
  incidents: IncidentRow[];
  generatedAt: string;
}

const RANK: Record<string, number> = { unknown: 0, degraded: 1, partial_outage: 2, major_outage: 3 };

const overlaps = (incident: IncidentRow, from: string, to: string): boolean =>
  Date.parse(incident.startedAt) <= Date.parse(to) &&
  (incident.resolvedAt === null || Date.parse(incident.resolvedAt) >= Date.parse(from));

/**
 * Runs of non-operational polls, oldest first. A run is closed by the next
 * operational poll; one still running when the polls end has no end, and the
 * document says "still down at the last poll" rather than inventing one.
 */
export function downtimeWindows(
  samples: readonly SampleRow[],
  intervalMinutes: number,
  incidents: readonly IncidentRow[],
): DowntimeWindow[] {
  const windows: DowntimeWindow[] = [];
  let open: { startedAt: string; lastAt: string; polls: number; worst: string } | null = null;

  const close = (endedAt: string | null): void => {
    if (open === null) return;
    const until = endedAt ?? open.lastAt;
    const startedAt = open.startedAt;
    windows.push({
      startedAt,
      endedAt,
      minutes: open.polls * intervalMinutes,
      worstStatus: open.worst,
      incidentIds: incidents
        .filter((incident) => overlaps(incident, startedAt, until))
        .map((incident) => incident.incidentId),
    });
    open = null;
  };

  for (const sample of samples) {
    if (sample.ok) {
      close(sample.observedAt);
      continue;
    }
    if (open === null) {
      open = { startedAt: sample.observedAt, lastAt: sample.observedAt, polls: 1, worst: sample.overallStatus };
      continue;
    }
    open.lastAt = sample.observedAt;
    open.polls += 1;
    if ((RANK[sample.overallStatus] ?? 0) > (RANK[open.worst] ?? 0)) open.worst = sample.overallStatus;
  }
  close(null);
  return windows;
}

export interface SlaEvidenceInput {
  providerId: string;
  providerName: string;
  statusPage: string;
  target: number;
  month: string;
  from: string;
  to: string;
  partial: boolean;
  monthMinutes: number;
  intervalMinutes: number;
  report: MonthlyProviderReport;
  samples: readonly SampleRow[];
  incidents: readonly IncidentRow[];
  generatedAt: string;
}

export function buildSlaEvidence(input: SlaEvidenceInput): SlaEvidence {
  const { report } = input;
  return {
    providerId: input.providerId,
    providerName: input.providerName,
    statusPage: input.statusPage,
    month: input.month,
    from: input.from,
    to: input.to,
    partial: input.partial,
    target: input.target,
    uptime: report.uptime,
    belowTarget: report.uptime !== null && report.uptime < input.target,
    intervalMinutes: input.intervalMinutes,
    allowedMinutes: Math.round((input.monthMinutes * (100 - input.target)) / 100),
    downtimeMinutes: report.downtimeMinutes,
    sampleCount: report.sampleCount,
    rawSampleCount: input.samples.length,
    windows: downtimeWindows(input.samples, input.intervalMinutes, input.incidents),
    incidents: [...input.incidents].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    generatedAt: input.generatedAt,
  };
}

/** Pipes escaped and newlines folded, so a provider's incident title cannot break a table row. */
const inline = (text: string): string => text.replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");

export function renderSlaEvidence(evidence: SlaEvidence): string {
  const lines: string[] = [];
  lines.push(`# SLA evidence — ${inline(evidence.providerName)}, ${monthTitle(evidence.month)}`);
  lines.push("");
  lines.push(`- **Provider:** ${inline(evidence.providerName)}`);
  lines.push(`- **Status page:** ${evidence.statusPage}`);
  lines.push(`- **Period:** ${evidence.from} to ${evidence.to}${evidence.partial ? " (month still running)" : ""}`);
  lines.push(`- **Committed uptime:** ${percent(evidence.target)}`);
  lines.push(`- **Measured uptime:** ${percent(evidence.uptime)}`);
  lines.push(`- **Downtime measured:** ${duration(evidence.downtimeMinutes)} (${evidence.downtimeMinutes} minutes)`);
  lines.push(`- **Downtime the commitment allows:** ${duration(evidence.allowedMinutes)} (${evidence.allowedMinutes} minutes)`);
  lines.push("");

  if (evidence.uptime === null) {
    lines.push("Nothing was measured for this provider in the period, so no claim can be made from it.");
  } else if (evidence.belowTarget) {
    lines.push(
      `**Measured uptime is below the committed ${percent(evidence.target)}.** The provider may owe a service credit under its SLA; check the agreement for the claim window and the credit schedule.`,
    );
    if (evidence.partial) {
      lines.push("");
      lines.push("The month is not over: the figure can still move, and most agreements only accept a claim for a closed month.");
    }
  } else {
    lines.push(`Measured uptime meets the committed ${percent(evidence.target)}.`);
  }
  lines.push("");

  lines.push("## How it was measured");
  lines.push("");
  lines.push(
    `IsItDown polled the provider's public status page every ${evidence.intervalMinutes} minute(s). Each poll that did not read fully operational counts as ${evidence.intervalMinutes} minute(s) of downtime; uptime is the share of polls that did. ${evidence.sampleCount} polls were taken in the period.`,
  );
  lines.push("");
  lines.push(
    "This is the provider's own published status, observed from outside — not a probe of the service itself. A provider that is slow to declare an outage will read as up here until it does.",
  );
  lines.push("");

  lines.push("## Downtime windows");
  lines.push("");
  lines.push("All times UTC. A window runs from the first poll that read anything other than operational to the first poll that read operational again.");
  lines.push("");
  const missing = evidence.sampleCount - evidence.rawSampleCount;
  if (missing > 0) {
    lines.push(
      `> ${missing} of the ${evidence.sampleCount} polls in this period are no longer held one by one — retention has folded them into daily totals — so the windows below cover only the polls still held. The uptime figure above still counts every poll.`,
    );
    lines.push("");
  }
  if (evidence.windows.length === 0) {
    lines.push("No poll in the period read anything other than operational.");
  } else {
    lines.push("| Started | Ended | Minutes | Worst status | Provider incidents |");
    lines.push("|---|---|---|---|---|");
    for (const entry of evidence.windows) {
      lines.push(
        `| ${entry.startedAt} | ${entry.endedAt ?? "still down at the last poll"} | ${entry.minutes} | ${entry.worstStatus.replace("_", " ")} | ${
          entry.incidentIds.length === 0 ? "none declared" : entry.incidentIds.map(inline).join(", ")
        } |`,
      );
    }
  }
  lines.push("");

  lines.push("## Incidents on the provider's status page");
  lines.push("");
  if (evidence.incidents.length === 0) {
    lines.push("The provider declared no incident open at any point in the period.");
  } else {
    lines.push("| Reference | Title | Impact | Started | Resolved |");
    lines.push("|---|---|---|---|---|");
    for (const incident of evidence.incidents) {
      lines.push(
        `| ${inline(incident.incidentId)} | ${inline(incident.name)} | ${inline(incident.impact)} | ${incident.startedAt} | ${
          incident.resolvedAt ?? "still open"
        } |`,
      );
    }
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated by IsItDown on ${evidence.generatedAt}, from one observer on one network. Attach it to the claim as the customer's own record; the provider's figures are the ones the agreement is settled on.`,
  );
  lines.push("");
  return lines.join("\n");
}
