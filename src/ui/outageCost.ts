import type { IncidentRow } from "./historyStore.interface.ts";

/**
 * What an hour of each provider being down costs the operator — roadmap 6.3.
 * Built from the services as they are now, so a figure edited in Settings
 * reaches the next report without a restart.
 */
export type CostRates = ReadonlyMap<string, number>;

export function costRatesOf(
  services: readonly { id: string; outageCostPerHour?: number | undefined }[],
): CostRates {
  return new Map(
    services.flatMap((service) =>
      service.outageCostPerHour === undefined ? [] : [[service.id, service.outageCostPerHour] as const],
    ),
  );
}

/**
 * The cost of `minutes` of downtime, or `null` when the operator declared no
 * rate. Null rather than 0: an undeclared price is not a free outage, and a
 * report that printed 0 would be asserting it.
 */
export function downtimeCost(rates: CostRates, providerId: string, minutes: number): number | null {
  const rate = rates.get(providerId);
  return rate === undefined ? null : Math.round((minutes / 60) * rate * 100) / 100;
}

/** An incident's cost, running until it resolves: an open one is priced to `nowMs`. */
export function incidentCost(rates: CostRates, incident: IncidentRow, nowMs: number): number | null {
  const end = incident.resolvedAt === null ? nowMs : Date.parse(incident.resolvedAt);
  const minutes = Math.max(0, (end - Date.parse(incident.startedAt)) / 60_000);
  return downtimeCost(rates, incident.providerId, minutes);
}
