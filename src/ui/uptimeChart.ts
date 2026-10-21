import type { OverallStatus } from "../core/types.ts";
import type { SampleRow } from "./historyStore.interface.ts";

/**
 * The provider's last 24 hours as one SVG bar — roadmap 3.12.
 *
 * SVG and nothing else, written by hand: a rasteriser would add a native
 * dependency to every image and to the single-file binary, for a picture that
 * is forty-eight rectangles. The cost is who can show it: a channel has to
 * accept an SVG, which in practice means email (attached) and the webhook (a
 * field). The ones that only take a photo get no chart rather than a broken one.
 *
 * Forty-eight half-hour cells, each as bad as the worst reading inside it, so a
 * five-minute outage is visible rather than averaged away; a cell with no reading
 * is grey and says so, because "nothing measured" and "up" must not look alike.
 * Status is never colour alone: every cell carries a `<title>`, and the bar has
 * a text description for whatever reads it without drawing it.
 */

const CELLS = 48;
const CELL_MS = (24 * 3600_000) / CELLS;
const CELL_WIDTH = 10;
const CELL_GAP = 2;
const HEIGHT = 40;

const FILL: Record<OverallStatus | "none", string> = {
  operational: "#2e9e5b",
  degraded: "#d9a31a",
  partial_outage: "#e07b1f",
  major_outage: "#d2392e",
  unknown: "#8a8f98",
  none: "#d5d8dd",
};

const RANK: Record<OverallStatus, number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The worst reading in each half hour of the 24 ending at `now`, oldest cell first. */
export function cellsOf(samples: readonly SampleRow[], now: Date): (OverallStatus | "none")[] {
  const end = now.getTime();
  const start = end - CELLS * CELL_MS;
  const cells: (OverallStatus | "none")[] = Array.from({ length: CELLS }, () => "none");
  for (const sample of samples) {
    const taken = Date.parse(sample.observedAt);
    if (Number.isNaN(taken) || taken < start || taken > end) continue;
    const index = Math.min(CELLS - 1, Math.floor((taken - start) / CELL_MS));
    const seen = cells[index];
    if (seen === undefined || seen === "none" || RANK[sample.overallStatus] > RANK[seen]) {
      cells[index] = sample.overallStatus;
    }
  }
  return cells;
}

export function renderUptimeBar(samples: readonly SampleRow[], now: Date, name: string): string {
  const cells = cellsOf(samples, now);
  const width = CELLS * (CELL_WIDTH + CELL_GAP) - CELL_GAP;
  const measured = cells.filter((cell) => cell !== "none");
  const down = measured.filter((cell) => cell !== "operational" && cell !== "unknown").length;
  const summary =
    measured.length === 0
      ? `${name}: nothing measured in the last 24 hours`
      : `${name}: ${down} of ${measured.length} measured half hours had a problem in the last 24 hours`;
  const start = now.getTime() - CELLS * CELL_MS;
  const rects = cells
    .map((cell, index) => {
      const from = new Date(start + index * CELL_MS).toISOString().slice(11, 16);
      const label = cell === "none" ? "no reading" : cell.replace("_", " ");
      return `<rect x="${index * (CELL_WIDTH + CELL_GAP)}" y="0" width="${CELL_WIDTH}" height="${HEIGHT}" rx="2" fill="${FILL[cell]}"><title>${from} UTC — ${label}</title></rect>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" role="img" aria-label="${escape(summary)}"><title>${escape(summary)}</title>${rects}</svg>`;
}

export interface ChartDeps {
  recentSamples(providerId: string, limit: number): Promise<SampleRow[]>;
  now?: (() => Date) | undefined;
}

export function createChartService(deps: ChartDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    /**
     * The bar for one provider, or null when it has never been measured: a chart
     * made only of grey cells says nothing the message does not already say, and
     * an attachment that is an empty rectangle reads as broken.
     */
    async uptimeBar(providerId: string, name: string, intervalMinutes: number): Promise<string | null> {
      // A day's worth of readings at the cadence it was polled at, with a margin
      // for the adaptive cadence going faster during an incident.
      const limit = Math.ceil((24 * 60) / Math.max(1, intervalMinutes)) * 3;
      const samples = await deps.recentSamples(providerId, limit);
      if (samples.length === 0) return null;
      return renderUptimeBar(samples, now(), name);
    },
  };
}
