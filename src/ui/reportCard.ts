import type { IncidentRow } from "./historyStore.interface.ts";
import { EPISODE_FLOOR, type StoredEpisode } from "./trust.ts";

/**
 * The quarterly vendor report card — roadmap 6.8.
 *
 * One grade per axis, never one grade per vendor. Availability, how promptly
 * the page admitted an outage, how long outages took to clear and how many
 * there were are four different failures: a vendor that is down twice a year
 * for a day and one that blips every week for two minutes can share an uptime
 * figure and deserve very different conversations. Folding them into a single
 * letter would undo exactly what the trust card refuses to do.
 *
 * Pure: the route reads the quarter out of the store and hands it over, so the
 * grading can be tested against plain rows and rendered without a database.
 */

export type Grade = "A" | "B" | "C" | "D" | "E";

/**
 * Where each grade starts, best first. Fixed and printed with every card: a
 * grade whose thresholds are not on the page is an opinion, and a card is
 * something that gets forwarded to the vendor.
 */
export const SCALE = {
  /** Uptime %, at least. */
  availability: [99.95, 99.9, 99.5, 99],
  /** Median minutes from outage to admission, at most. */
  admission: [5, 15, 30, 60],
  /** Mean minutes to resolution, at most. */
  mttr: [30, 60, 120, 240],
  /** Incidents started in the quarter, at most. */
  incidents: [0, 2, 5, 10],
} as const;

const GRADES: Grade[] = ["A", "B", "C", "D", "E"];

function gradeAtLeast(value: number, steps: readonly number[]): Grade {
  const index = steps.findIndex((step) => value >= step);
  return GRADES[index === -1 ? steps.length : index]!;
}

function gradeAtMost(value: number, steps: readonly number[]): Grade {
  const index = steps.findIndex((step) => value <= step);
  return GRADES[index === -1 ? steps.length : index]!;
}

/** `YYYY-Qn` to its first and last day, or null when it is not one. */
export function quarterRange(quarter: string): { from: string; to: string } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (match === null) return null;
  const year = Number(match[1]);
  const first = (Number(match[2]) - 1) * 3;
  const from = new Date(Date.UTC(year, first, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, first + 3, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** The quarter a UTC day falls in. */
export function quarterOf(day: string): string {
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
}

export interface AdmissionAxis {
  /** Episodes inside the quarter that count, as the trust card counts them. */
  counted: number;
  admitted: number;
  /**
   * Median minutes to admission over *every* counted outage, a never-admitted
   * one sorting last. `null` when the median outage was never admitted, or
   * when there are too few to grade at all.
   */
  medianMinutes: number | null;
  grade: Grade | null;
}

/**
 * The trust-card axis over one quarter's episodes.
 *
 * A never-admitted outage is ranked as the latest possible admission rather
 * than left out: a median over the admitted ones alone would grade a page that
 * stayed silent through half its outages on how fast it was the other half.
 * Below the trust card's own episode floor there is no grade, for the reason
 * the card gives — a handful of episodes is an anecdote.
 */
export function admissionOf(episodes: readonly StoredEpisode[], from: string, to: string): AdmissionAxis {
  const counted = episodes.filter(
    (episode) =>
      episode.excluded === null && episode.probeDownAt.slice(0, 10) >= from && episode.probeDownAt.slice(0, 10) <= to,
  );
  const delays = counted
    .map((episode) => episode.delayMinutes ?? Number.POSITIVE_INFINITY)
    .sort((left, right) => left - right);
  const admitted = delays.filter(Number.isFinite).length;
  if (counted.length < EPISODE_FLOOR) {
    return { counted: counted.length, admitted, medianMinutes: null, grade: null };
  }
  const median = delays[Math.floor(delays.length / 2)]!;
  return {
    counted: counted.length,
    admitted,
    medianMinutes: Number.isFinite(median) ? median : null,
    grade: gradeAtMost(median, SCALE.admission),
  };
}

export interface ReportCardInput {
  quarter: string;
  from: string;
  /** Last day covered: the quarter's last, or today while it is still running. */
  to: string;
  partial: boolean;
  generatedAt: string;
  providers: {
    providerId: string;
    name: string;
    /** Uptime over the quarter's samples, or null when it has none. */
    uptime: number | null;
    /** null when no probe cross-checks this provider's page. */
    admission: AdmissionAxis | null;
  }[];
  /** Every incident open at some point in the quarter. */
  incidents: IncidentRow[];
}

export interface ProviderReportCard {
  providerId: string;
  name: string;
  availability: { uptime: number | null; grade: Grade | null };
  admission: AdmissionAxis | null;
  mttr: { minutes: number | null; resolved: number; grade: Grade | null };
  incidents: { count: number; grade: Grade };
}

export interface ReportCard {
  quarter: string;
  from: string;
  to: string;
  partial: boolean;
  generatedAt: string;
  scale: typeof SCALE;
  providers: ProviderReportCard[];
}

export function buildReportCard(input: ReportCardInput): ReportCard {
  const providers = input.providers.map((provider): ProviderReportCard => {
    // Started inside the quarter, as the reliability table counts onset: an
    // outage that began in June is June's, even if it ran into July.
    const started = input.incidents.filter(
      (incident) =>
        incident.providerId === provider.providerId &&
        incident.startedAt.slice(0, 10) >= input.from &&
        incident.startedAt.slice(0, 10) <= input.to,
    );
    const durations = started
      .filter((incident) => incident.resolvedAt !== null)
      .map((incident) => Math.max(0, (Date.parse(incident.resolvedAt!) - Date.parse(incident.startedAt)) / 60_000));
    const mttr =
      durations.length === 0 ? null : Math.round(durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length);

    return {
      providerId: provider.providerId,
      name: provider.name,
      availability: {
        uptime: provider.uptime,
        grade: provider.uptime === null ? null : gradeAtLeast(provider.uptime, SCALE.availability),
      },
      admission: provider.admission,
      mttr: { minutes: mttr, resolved: durations.length, grade: mttr === null ? null : gradeAtMost(mttr, SCALE.mttr) },
      incidents: { count: started.length, grade: gradeAtMost(started.length, SCALE.incidents) },
    };
  });

  return {
    quarter: input.quarter,
    from: input.from,
    to: input.to,
    partial: input.partial,
    generatedAt: input.generatedAt,
    scale: SCALE,
    providers,
  };
}

const cell = (grade: Grade | null, value: string): string => (grade === null ? "—" : `${grade} · ${value}`);

function minutes(value: number): string {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The card as Markdown, written to be pasted into a vendor review as it is.
 * English, like the monthly report: a document that leaves the dashboard is
 * read by whoever it is sent to, not in the operator's locale.
 */
export function renderReportCard(card: ReportCard): string {
  const lines = [
    `# Vendor report card — ${card.quarter.replace("-", " ")}`,
    "",
    `${card.from} to ${card.to}. Generated ${card.generatedAt}.`,
    "",
  ];
  if (card.partial) {
    lines.push(`> The quarter is still running: these grades cover it up to ${card.to} and will move.`, "");
  }
  lines.push(
    "| Provider | Availability | Admission | MTTR | Incidents |",
    "| --- | --- | --- | --- | --- |",
    ...card.providers.map((provider) => {
      const admission = provider.admission;
      const admissionCell =
        admission === null || admission.grade === null
          ? "—"
          : cell(admission.grade, admission.medianMinutes === null ? "mostly never" : minutes(admission.medianMinutes));
      return `| ${provider.name} | ${cell(
        provider.availability.grade,
        `${provider.availability.uptime?.toFixed(2)}%`,
      )} | ${admissionCell} | ${cell(
        provider.mttr.grade,
        provider.mttr.minutes === null ? "" : minutes(provider.mttr.minutes),
      )} | ${cell(provider.incidents.grade, String(provider.incidents.count))} |`;
    }),
    "",
    "## Scale",
    "",
    "Four axes, graded A (best) to E, never combined into one grade: a vendor that is down twice a year for a day and one that blips every week deserve different conversations.",
    "",
    `- **Availability** — uptime over the quarter's polls. A from ${SCALE.availability[0]}%, B from ${SCALE.availability[1]}%, C from ${SCALE.availability[2]}%, D from ${SCALE.availability[3]}%, E below.`,
    `- **Admission** — median minutes from an outage our probe saw to the status page admitting it, a never-admitted outage counting as the latest. A within ${SCALE.admission[0]}m, B ${SCALE.admission[1]}m, C ${SCALE.admission[2]}m, D ${SCALE.admission[3]}m, E later. Needs a probe cross-checking the page and at least ${EPISODE_FLOOR} outages in the quarter; one network, one location.`,
    `- **MTTR** — mean minutes to resolution of the incidents that started in the quarter and were resolved. A within ${SCALE.mttr[0]}m, B ${SCALE.mttr[1]}m, C ${SCALE.mttr[2]}m, D ${SCALE.mttr[3]}m, E longer.`,
    `- **Incidents** — incidents that started in the quarter. A none, B up to ${SCALE.incidents[1]}, C ${SCALE.incidents[2]}, D ${SCALE.incidents[3]}, E more.`,
    "",
    "— means the quarter cannot answer that axis: no polls, no resolved incident, no cross-checking probe, or too few outages.",
    "",
  );
  return lines.join("\n");
}
