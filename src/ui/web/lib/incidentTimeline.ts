/** One incident as the Gantt needs it — roadmap 4.12; the `/incidents/timeline` row. */
export interface TimelineIncident {
  providerId: string;
  incidentId: string;
  name: string;
  impact: string;
  startedAt: string;
  resolvedAt: string | null;
}

export interface TimelineBar {
  incident: TimelineIncident;
  /** Percent of the window from the left edge. */
  left: number;
  /** Percent of the window, never below the minimum a bar needs to be seen. */
  width: number;
  /** Still running at the end of the window. */
  open: boolean;
}

export interface TimelineLane {
  providerId: string;
  bars: TimelineBar[];
}

export interface Overlap {
  startMs: number;
  endMs: number;
  providerIds: string[];
}

/** A one-minute incident is still an incident: below this a bar would not be drawn at all. */
const MIN_WIDTH_PERCENT = 0.4;

/** An incident still open runs to the window's end — and past it. */
const endOf = (incident: TimelineIncident, toMs: number): number =>
  incident.resolvedAt === null ? toMs : Date.parse(incident.resolvedAt);

/**
 * One lane per provider, in the order given, each bar clipped to the window.
 * A provider with nothing in the window keeps its (empty) lane: rows that
 * appear and disappear with the data would move under the operator's eye.
 */
export function timelineLanes(
  incidents: readonly TimelineIncident[],
  providerIds: readonly string[],
  fromMs: number,
  toMs: number,
): TimelineLane[] {
  const span = toMs - fromMs;
  return providerIds.map((providerId) => ({
    providerId,
    bars: incidents
      .filter((incident) => incident.providerId === providerId)
      .flatMap((incident): TimelineBar[] => {
        const start = Math.max(Date.parse(incident.startedAt), fromMs);
        const end = Math.min(endOf(incident, toMs), toMs);
        if (end < fromMs || start > toMs) return [];
        const left = ((start - fromMs) / span) * 100;
        const width = Math.max(((end - start) / span) * 100, MIN_WIDTH_PERCENT);
        return [{ incident, left, width, open: incident.resolvedAt === null }];
      }),
  }));
}

/**
 * The stretches where two or more *different* providers were in an incident at
 * once — the correlated outages the chronological list hides. A provider's own
 * incidents overlapping each other say nothing about the others, so they count
 * once.
 */
export function overlaps(incidents: readonly TimelineIncident[], fromMs: number, toMs: number): Overlap[] {
  const edges = incidents.flatMap((incident) => {
    const start = Math.max(Date.parse(incident.startedAt), fromMs);
    const end = Math.min(endOf(incident, toMs), toMs);
    return end > start ? [{ at: start, delta: 1, providerId: incident.providerId }, { at: end, delta: -1, providerId: incident.providerId }] : [];
  });
  // Ends before starts at the same instant: two incidents that touch do not overlap.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);

  const open = new Map<string, number>();
  const found: Overlap[] = [];
  let since: number | null = null;
  let who: string[] = [];
  for (const edge of edges) {
    const count = (open.get(edge.providerId) ?? 0) + edge.delta;
    if (count === 0) open.delete(edge.providerId);
    else open.set(edge.providerId, count);

    const ids = [...open.keys()].sort();
    if (since !== null && (ids.length < 2 || ids.join() !== who.join()) && edge.at > since) {
      found.push({ startMs: since, endMs: edge.at, providerIds: who });
      since = null;
    }
    if (ids.length >= 2 && since === null) {
      since = edge.at;
      who = ids;
    }
  }
  return found;
}
