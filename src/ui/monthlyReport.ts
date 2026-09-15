import type { MonthlyProviderReport, MonthlyReport } from "./history.ts";

/**
 * The monthly report, as Markdown — roadmap 4.7.
 *
 * Markdown rather than a rendered page, because the thing somebody actually
 * does with a month of uptime is paste it: into a ticket, a wiki, a mail to
 * whoever asked. A print stylesheet would have made that the one thing it is
 * bad at, and a browser prints this perfectly well through whatever renders it.
 *
 * Everything here comes from `getMonthlyReport`, which reads the same daily
 * buckets and incident rows the History view is drawn from, so the document and
 * the screen it was taken beside can never disagree. This file only decides how
 * it reads.
 *
 * English, and deliberately not a catalog key: this is a document a reader
 * takes away, not a surface the dashboard renders. It is written once, in the
 * language the exports and the API already speak, rather than being pinned to
 * whichever locale the operator's browser happened to be in.
 */

/** How a provider is named in the report: its own name, falling back to its id. */
export type ProviderNames = Map<string, string>;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-08` as `August 2026`, or as itself if it is not a month after all. */
export function monthTitle(month: string): string {
  const [year, index] = month.split("-");
  const name = MONTH_NAMES[Number(index) - 1];
  return name === undefined || year === undefined ? month : `${name} ${year}`;
}

/** Two decimals and a sign, or an em dash for a figure nothing measured. */
const percent = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)}%`);

/**
 * Minutes as the sentence somebody reads rather than as a number they convert:
 * "3 h 12 m" answers "how bad was it" in a way "192" does not.
 */
export function duration(minutes: number): string {
  if (minutes <= 0) return "none";
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

/** A table cell's text is escaped for the one character that would break the row. */
const cell = (text: string): string => text.replaceAll("|", "\\|");

const worstDayCell = (provider: MonthlyProviderReport): string =>
  provider.worstDay === null ? "—" : `${provider.worstDay.day} (${percent(provider.worstDay.uptime)})`;

export function renderMonthlyReport(report: MonthlyReport, names: ProviderNames): string {
  const name = (providerId: string): string => names.get(providerId) ?? providerId;
  const lines: string[] = [];

  lines.push(`# Uptime report — ${monthTitle(report.month)}`);
  lines.push("");
  lines.push(`Covering ${report.from} to ${report.to} (UTC).`);
  if (report.partial) {
    // Said in the document rather than only in a header: this is the sentence
    // that stops a partial month being read as a finished one three weeks later.
    lines.push("");
    lines.push(`**This month is still running**, so the figures below cover it only up to ${report.to}.`);
  }
  lines.push("");
  lines.push(`Fleet uptime: **${percent(report.fleetUptime)}**, across ${report.providers.length} provider(s).`);
  lines.push("");

  lines.push("## Uptime by provider");
  lines.push("");
  lines.push("| Provider | Uptime | Downtime | Incidents | Worst day | Days measured |");
  lines.push("|---|---|---|---|---|---|");

  // Worst first: a report is read from the top, and the row somebody needs is
  // the one that had the worst month. A provider nothing measured sorts last —
  // it has no month to compare.
  const ranked = [...report.providers].sort((a, b) => {
    if (a.uptime === null) return b.uptime === null ? a.providerId.localeCompare(b.providerId) : 1;
    if (b.uptime === null) return -1;
    return a.uptime - b.uptime || a.providerId.localeCompare(b.providerId);
  });

  for (const provider of ranked) {
    lines.push(
      `| ${cell(name(provider.providerId))} | ${percent(provider.uptime)} | ${duration(
        provider.downtimeMinutes,
      )} | ${provider.incidentCount} | ${worstDayCell(provider)} | ${provider.measuredDays} |`,
    );
  }
  lines.push("");

  lines.push("## Incidents");
  lines.push("");
  if (report.incidents.length === 0) {
    lines.push("No incident was open at any point in the month.");
  } else {
    lines.push("Every incident open at any point in the month, newest first. One that");
    lines.push("started earlier or is still open is listed too — the downtime above has to");
    lines.push("have something causing it.");
    lines.push("");
    lines.push("| Provider | Incident | Impact | Started | Resolved |");
    lines.push("|---|---|---|---|---|");
    for (const incident of report.incidents) {
      lines.push(
        `| ${cell(name(incident.providerId))} | ${cell(incident.name)} | ${cell(incident.impact)} | ${
          incident.startedAt
        } | ${incident.resolvedAt ?? "still open"} |`,
      );
    }
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated by IsItDown on ${new Date().toISOString()}. Uptime is the share of polls that read operational; a day with no samples is left out of the percentage rather than counted as an outage.`,
  );
  lines.push("");

  return lines.join("\n");
}
