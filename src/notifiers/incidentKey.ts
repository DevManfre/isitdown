import type { StatusChange } from "../core/types.ts";

/**
 * The stable key an on-call system de-duplicates on, shared by the channels
 * that have one (roadmap 3.7). Written once here so PagerDuty and Opsgenie
 * cannot disagree about what "the same alert" means — a trigger and the resolve
 * that closes it have to derive the same string from two different changes, and
 * two implementations of that rule is two chances for an alert to never close.
 *
 * An incident keys on its own id, so a provider with three open incidents holds
 * three alerts and each closes on its own. Everything else keys on what it is
 * about — the provider, one of its components, one maintenance window, our own
 * fetching — so a status that worsens twice updates one alert instead of
 * stacking.
 */
export function incidentKey(change: StatusChange): string {
  switch (change.kind) {
    case "incident_opened":
    case "incident_updated":
    case "incident_resolved":
      return `isitdown/${change.providerId}/incident/${change.incident?.id ?? "unknown"}`;
    case "component_status_change":
      return `isitdown/${change.providerId}/component/${change.component?.id ?? "unknown"}`;
    case "maintenance_started":
    case "maintenance_ended":
      return `isitdown/${change.providerId}/maintenance/${change.maintenance?.id ?? "unknown"}`;
    case "monitoring_degraded":
      return `isitdown/${change.providerId}/monitoring`;
    case "status_change":
      return `isitdown/${change.providerId}/status`;
    // One alert for the shared failure, keyed on who it covers: the same
    // providers going bad again is the same alert, a different set is another.
    // The page disagreeing with our probe is one standing alert per pair.
    case "silent_outage":
      return `isitdown/${change.providerId}/silent/${change.crossCheck?.probeId ?? "unknown"}`;
    case "correlated_outage":
      return `isitdown/correlated/${[...(change.correlated?.providerIds ?? [])].sort().join("+")}`;
  }
}

/**
 * Whether this change closes its alert rather than raising one. The lifecycle
 * an on-call system wants is exactly the one the diff engine already emits:
 * an incident that resolved, a maintenance window that ended, a status that
 * came back to operational. Anything else is still something happening.
 *
 * A digest never resolves: it is a batch whose most severe member stands in for
 * the rest, and closing an alert because the worst of five changes happened to
 * be a recovery would silence the four that were not.
 */
export function isResolution(change: StatusChange): boolean {
  if (change.kind === "incident_resolved" || change.kind === "maintenance_ended") return true;
  if (change.kind === "status_change" || change.kind === "component_status_change") {
    return change.currentStatus === "operational";
  }
  return false;
}
