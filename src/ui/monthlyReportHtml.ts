import type { OverallStatus } from "../core/types.ts";
import { shiftDay } from "./calendarDays.ts";
import type { MonthlyProviderReport, MonthlyReport } from "./history.ts";
import { duration, monthTitle, percent, ranked, type ProviderNames } from "./monthlyReport.ts";
import { escape, FILL } from "./uptimeChart.ts";

/**
 * The monthly report as one self-contained HTML page — roadmap 6.6.
 *
 * The Markdown version is for pasting; this one is for attaching. Whoever the
 * month goes to by mail wants a page that opens anywhere and prints to PDF from
 * the browser, with the pictures in it — so the page carries its own styles and
 * its charts as inline SVG, and loads nothing: a report that fetches a font or a
 * script is a report that prints differently, or not at all, off the network
 * it was made on.
 *
 * Same figures as the Markdown, from the same `MonthlyReport`, in the same
 * order; English for the same reason (see `monthlyReport.ts`). The colours are
 * the notification chart's, so one status reads as one colour in everything
 * IsItDown hands out.
 */

const CELL = 14;
const GAP = 2;
const STRIP_HEIGHT = 18;
const BAR_WIDTH = 360;
const BAR_HEIGHT = 14;
const BAR_ROW = 22;
const LABEL_WIDTH = 160;
/**
 * One ink for every bar: the bar's job is the length. Status lives in the
 * daily strip below, where a colour stands for one day rather than a month.
 */
const BAR_INK = "#4b5563";

/** `2026-08-04T10:03:12.000Z` → `2026-08-04 10:03`, which fits a table cell without wrapping mid-token. */
const minute = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** Every calendar day from `from` to `to`, both inclusive. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/**
 * One cell per day of the month, coloured by the worst status seen that day.
 * A day with no samples is grey and says so in its title: "not measured" and
 * "up" must not look alike, on paper least of all.
 */
function dailyStrip(provider: MonthlyProviderReport, name: string, from: string, to: string): string {
  const byDay = new Map(provider.days.map((entry) => [entry.day, entry]));
  const days = daysBetween(from, to);
  const width = days.length * (CELL + GAP) - GAP;
  const bad = provider.days.filter((entry) => entry.uptime < 100).length;
  const summary =
    provider.days.length === 0
      ? `${name}: nothing measured in the period`
      : `${name}: ${bad} of ${provider.days.length} measured days had downtime`;
  const cells = days
    .map((day, index) => {
      const entry = byDay.get(day);
      const status: OverallStatus | "none" = entry === undefined ? "none" : entry.status;
      const label = entry === undefined ? "no reading" : `${percent(entry.uptime)}, worst ${entry.status.replace("_", " ")}`;
      return `<rect x="${index * (CELL + GAP)}" y="0" width="${CELL}" height="${STRIP_HEIGHT}" rx="2" fill="${FILL[status]}"><title>${day} — ${escape(label)}</title></rect>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${STRIP_HEIGHT}" viewBox="0 0 ${width} ${STRIP_HEIGHT}" role="img" aria-label="${escape(summary)}"><title>${escape(summary)}</title>${cells}</svg>`;
}

/**
 * Uptime per provider as horizontal bars, worst first. The axis cannot start at
 * zero — every bar would be the same full length — so it starts at the lowest
 * whole percent the month needs (95% at most), and the chart says where it
 * starts in its own caption rather than leaving a zoomed axis to mislead.
 */
function uptimeBars(providers: MonthlyProviderReport[], name: (id: string) => string): { svg: string; floor: number } {
  const measured = providers.filter((provider): provider is MonthlyProviderReport & { uptime: number } => provider.uptime !== null);
  const lowest = Math.min(95, ...measured.map((provider) => Math.floor(provider.uptime)));
  const floor = Math.max(0, lowest);
  const height = Math.max(1, measured.length) * BAR_ROW;
  const width = LABEL_WIDTH + BAR_WIDTH + 70;
  const rows = measured
    .map((provider, index) => {
      const y = index * BAR_ROW;
      const share = floor === 100 ? 1 : (provider.uptime - floor) / (100 - floor);
      const length = Math.max(1, Math.round(share * BAR_WIDTH));
      return [
        `<text x="${LABEL_WIDTH - 8}" y="${y + BAR_HEIGHT - 2}" text-anchor="end">${escape(name(provider.providerId))}</text>`,
        `<rect x="${LABEL_WIDTH}" y="${y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="2" fill="${FILL.none}"/>`,
        `<rect x="${LABEL_WIDTH}" y="${y}" width="${length}" height="${BAR_HEIGHT}" rx="2" fill="${BAR_INK}"><title>${escape(name(provider.providerId))} — ${percent(provider.uptime)}</title></rect>`,
        `<text x="${LABEL_WIDTH + BAR_WIDTH + 8}" y="${y + BAR_HEIGHT - 2}">${percent(provider.uptime)}</text>`,
      ].join("");
    })
    .join("");
  const summary =
    measured.length === 0
      ? "No provider was measured in the period"
      : `Uptime by provider, worst first: ${measured.map((provider) => `${name(provider.providerId)} ${percent(provider.uptime)}`).join(", ")}`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(summary)}" font-size="12" font-family="inherit" fill="#1f2328"><title>${escape(summary)}</title>${rows}</svg>`,
    floor,
  };
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff; color: #1f2328; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 780px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  p { margin: 0 0 12px; }
  .muted { color: #59636e; }
  .notice { border-left: 3px solid #d9a31a; padding: 8px 12px; background: #fdf8e8; }
  .headline { font-size: 32px; font-weight: 600; margin: 16px 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d5d8dd; vertical-align: top; }
  th { font-weight: 600; }
  td.when { white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .strips td { border: 0; padding: 3px 8px 3px 0; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; margin-top: 8px; }
  .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; background: var(--swatch); vertical-align: -1px; }
  footer { margin-top: 40px; font-size: 12px; color: #59636e; }
  svg { display: block; max-width: 100%; height: auto; }
  @media print {
    main { padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    tr, svg { break-inside: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function renderMonthlyReportHtml(report: MonthlyReport, names: ProviderNames, generatedAt: string): string {
  const name = (providerId: string): string => names.get(providerId) ?? providerId;
  const providers = ranked(report.providers);
  const priced = report.providers.some((provider) => provider.downtimeCost !== null);
  const bars = uptimeBars(providers, name);
  const title = `Uptime report — ${monthTitle(report.month)}`;

  const legend = (["operational", "degraded", "partial_outage", "major_outage", "none"] as const)
    .map((status) => `<span style="--swatch: ${FILL[status]}">${status === "none" ? "no reading" : status.replace("_", " ")}</span>`)
    .join("");

  const providerRows = providers
    .map(
      (provider) => `<tr>
        <td>${escape(name(provider.providerId))}</td>
        <td class="num">${percent(provider.uptime)}</td>
        <td class="num">${duration(provider.downtimeMinutes)}</td>
        ${priced ? `<td class="num">${provider.downtimeCost === null ? "—" : provider.downtimeCost.toFixed(2)}</td>` : ""}
        <td class="num">${provider.incidentCount}</td>
        <td>${provider.worstDay === null ? "—" : `${provider.worstDay.day} (${percent(provider.worstDay.uptime)})`}</td>
        <td class="num">${provider.measuredDays}</td>
      </tr>`,
    )
    .join("");

  const strips = providers
    .map(
      (provider) =>
        `<tr><td>${escape(name(provider.providerId))}</td><td>${dailyStrip(provider, name(provider.providerId), report.from, report.to)}</td></tr>`,
    )
    .join("");

  const incidents =
    report.incidents.length === 0
      ? `<p>No incident was open at any point in the period.</p>`
      : `<p class="muted">Every incident open at any point in the period, newest first — including one that started earlier or is still open, because the downtime above has to have something causing it. Times UTC.</p>
        <table>
          <thead><tr><th>Provider</th><th>Incident</th><th>Impact</th><th>Started</th><th>Resolved</th></tr></thead>
          <tbody>${report.incidents
            .map(
              (incident) => `<tr>
                <td>${escape(name(incident.providerId))}</td>
                <td>${escape(incident.name)}</td>
                <td>${escape(incident.impact)}</td>
                <td class="when">${escape(minute(incident.startedAt))}</td>
                <td class="when">${incident.resolvedAt === null ? "still open" : escape(minute(incident.resolvedAt))}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>${escape(title)}</h1>
  <p class="muted">Covering ${report.from} to ${report.to}.</p>
  ${
    report.partial
      ? `<p class="notice"><strong>This month is still running</strong>, so the figures below cover it only up to ${report.to}.</p>`
      : ""
  }
  <p class="headline">${percent(report.fleetUptime)}</p>
  <p class="muted">Fleet uptime, across ${report.providers.length} provider(s).</p>

  <h2>Uptime by provider</h2>
  ${bars.svg}
  <p class="muted">The axis starts at ${bars.floor}%, not at zero, so the differences are visible.</p>
  <table>
    <thead><tr><th>Provider</th><th class="num">Uptime</th><th class="num">Downtime</th>${priced ? `<th class="num">Downtime cost</th>` : ""}<th class="num">Incidents</th><th>Worst day</th><th class="num">Days measured</th></tr></thead>
    <tbody>${providerRows}</tbody>
  </table>

  <h2>Day by day</h2>
  <p class="muted">One cell per day, coloured by the worst status seen that day.</p>
  <table class="strips"><tbody>${strips}</tbody></table>
  <div class="legend">${legend}</div>

  <h2>Incidents</h2>
  ${incidents}

  <footer>Generated by IsItDown on ${escape(generatedAt)}. Uptime is the share of polls that read operational; a day with no samples is left out of the percentage rather than counted as an outage. Print this page to save it as a PDF.</footer>
</main>
</body>
</html>
`;
}
