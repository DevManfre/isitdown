import { activeWindows } from "./maintenance.ts";
import type { NormalizedStatus, StatusChange } from "./types.ts";

/**
 * The single authority on whether a notification fires. Pure and synchronous:
 * no I/O, no logging, no locale awareness — it emits structured changes and the
 * notifier decides how to word them.
 *
 * Three rules carry most of the value:
 *  - a null `previous` is a baseline, never news, so a fresh container or a new
 *    provider cannot produce a burst of alerts;
 *  - `unknown` on either side is not a comparable status, so a failed or
 *    unrecognised poll can never be reported as a transition — in particular
 *    never as a false recovery;
 *  - a declared maintenance window running at `next.fetchedAt` swallows every
 *    other change for that poll — the operator already knows, so nothing else
 *    about the provider is news until the window ends.
 */
export function diff(previous: NormalizedStatus | null, next: NormalizedStatus): StatusChange[] {
  if (previous === null) return [];

  const base = { providerId: next.provider, at: next.fetchedAt };

  const runningBefore = new Map(activeWindows(previous).map((window) => [window.id, window]));
  const runningNow = new Map(activeWindows(next).map((window) => [window.id, window]));

  const maintenanceChanges: StatusChange[] = [];
  for (const [id, window] of runningNow) {
    if (runningBefore.has(id)) continue;
    maintenanceChanges.push({
      ...base,
      kind: "maintenance_started",
      currentStatus: next.overallStatus,
      maintenance: window,
    });
  }
  for (const [id, window] of runningBefore) {
    if (runningNow.has(id)) continue;
    maintenanceChanges.push({
      ...base,
      kind: "maintenance_ended",
      currentStatus: next.overallStatus,
      maintenance: window,
      openIncidents: next.activeIncidents.length,
    });
  }

  // A declared window is the operator's answer to "is this expected?" — while one
  // runs, nothing else about this provider is news. The reconciliation is
  // `maintenance_ended`, which carries the state the provider came out in, so a
  // real outage that began inside the window is announced rather than lost.
  if (runningNow.size > 0) return maintenanceChanges;

  const changes: StatusChange[] = [...maintenanceChanges];

  const comparable = previous.overallStatus !== "unknown" && next.overallStatus !== "unknown";
  if (comparable && previous.overallStatus !== next.overallStatus) {
    changes.push({
      ...base,
      kind: "status_change",
      previousStatus: previous.overallStatus,
      currentStatus: next.overallStatus,
    });
  }

  // Components follow the same two rules: a side the component is missing from
  // is a baseline (newly selected) or a removal (deselected or dropped by the
  // provider), never news; `unknown` is not comparable.
  const previousComponents = new Map(previous.components.map((component) => [component.id, component]));
  for (const component of next.components) {
    const seen = previousComponents.get(component.id);
    if (seen === undefined) continue;
    if (seen.status === "unknown" || component.status === "unknown") continue;
    if (seen.status !== component.status) {
      changes.push({
        ...base,
        kind: "component_status_change",
        previousStatus: seen.status,
        currentStatus: component.status,
        component: { id: component.id, name: component.name },
      });
    }
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
