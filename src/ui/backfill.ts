import type { HistoricalIncident, OverallStatus } from "../core/types.ts";
import type { SampleRow } from "./historyStore.interface.ts";

/** How far back the bars can possibly reach; the 90-day view is the widest. */
export const BACKFILL_DAYS = 90;

/**
 * What a historical incident's impact says about the samples under it. Unknown
 * words map to `degraded`, not `major_outage` as the live indicator does: an
 * incident of unknown impact is by definition at least a degradation, while
 * inventing a full outage would paint false red over reconstructed history.
 */
const IMPACT_STATUS: Record<string, OverallStatus> = {
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
};

const IMPACT_RANK: Record<string, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

/**
 * Reconstructs poll samples for the window [max(from, coverageStart), to) on a
 * grid of `intervalMinutes`, anchored at `from`. `to` is exclusive so a derived
 * sample can never collide with the earliest real one. A slot under no incident
 * is operational: the feed said nothing happened then, and it covers that time.
 */
export function deriveSamples(
  incidents: HistoricalIncident[],
  coverageStart: string | null,
  from: string,
  to: string,
  intervalMinutes: number,
): SampleRow[] {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const startMs = coverageStart === null ? fromMs : Math.max(fromMs, Date.parse(coverageStart));
  const stepMs = intervalMinutes * 60_000;

  const windows = incidents
    .map((incident) => ({
      start: Date.parse(incident.startedAt),
      end: incident.resolvedAt === null ? toMs : Date.parse(incident.resolvedAt),
      status: IMPACT_STATUS[incident.impact] ?? "degraded",
    }))
    .filter((window) => !Number.isNaN(window.start) && !Number.isNaN(window.end));

  const samples: SampleRow[] = [];
  for (let at = fromMs; at < toMs; at += stepMs) {
    if (at < startMs) continue;
    let worst: OverallStatus = "operational";
    for (const window of windows) {
      if (at >= window.start && at < window.end && IMPACT_RANK[window.status]! > IMPACT_RANK[worst]!) {
        worst = window.status;
      }
    }
    samples.push({
      observedAt: new Date(at).toISOString(),
      overallStatus: worst,
      ok: worst === "operational",
    });
  }
  return samples;
}
