import type { Incident, NormalizedStatus, StatusChange } from "./types.ts";

/**
 * The single authority on whether a notification fires. Pure and synchronous:
 * no I/O, no logging, no locale awareness — it emits structured changes and the
 * notifier decides how to word them.
 *
 * Two rules carry most of the value:
 *  - a null `previous` is a baseline, never news, so a fresh container or a new
 *    provider cannot produce a burst of alerts;
 *  - `unknown` on either side is not a comparable status, so a failed or
 *    unrecognised poll can never be reported as a transition — in particular
 *    never as a false recovery.
 */
export function diff(previous: NormalizedStatus | null, next: NormalizedStatus): StatusChange[] {
  if (previous === null) return [];

  const changes: StatusChange[] = [];
  const base = { providerId: next.provider, at: next.fetchedAt };

  const comparable = previous.overallStatus !== "unknown" && next.overallStatus !== "unknown";
  if (comparable && previous.overallStatus !== next.overallStatus) {
    changes.push({
      ...base,
      kind: "status_change",
      previousStatus: previous.overallStatus,
      currentStatus: next.overallStatus,
    });
  }

  const before = new Map(previous.activeIncidents.map((incident) => [incident.id, incident]));
  const after = new Map(next.activeIncidents.map((incident) => [incident.id, incident]));

  for (const incident of next.activeIncidents) {
    const seen = before.get(incident.id);
    if (seen === undefined) {
      changes.push({ ...base, kind: "incident_opened", currentStatus: next.overallStatus, incident });
      continue;
    }
    // A provider bumping `updatedAt` or rewording the title is not an event.
    if (seen.status !== incident.status || seen.impact !== incident.impact) {
      changes.push({ ...base, kind: "incident_updated", currentStatus: next.overallStatus, incident });
    }
  }

  for (const incident of previous.activeIncidents) {
    if (!after.has(incident.id)) {
      changes.push({
        ...base,
        kind: "incident_resolved",
        previousStatus: previous.overallStatus,
        currentStatus: next.overallStatus,
        incident,
      });
    }
  }

  return changes;
}
