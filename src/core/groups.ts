import type { ServiceDefinition } from "./configSource.interface.ts";
import type { OverallStatus } from "./types.ts";

/**
 * Provider groups — "my stack" (roadmap 2.6).
 *
 * A flat fleet answers "is GitHub healthy" and never "is my deploy path
 * healthy", which is the question an operator actually has: four providers they
 * do not care about individually, and one answer they do. A group is a slug on
 * a service definition, so both editions declare it the same way, and its
 * status is derived here rather than stored — a composite that could disagree
 * with its members would be worse than no composite at all.
 *
 * Worst member wins, with one deliberate exception: `unknown` is the absence of
 * a reading, not a severity (the same rule the diff engine and the routing
 * floors already follow), so a group with one unread provider and three healthy
 * ones reads as healthy, and only a group with nothing readable at all reads as
 * unknown.
 */

/** Worst first. `unknown` is outside the order on purpose — see the module note. */
const SEVERITY = ["major_outage", "partial_outage", "degraded", "operational"] as const;

type Ranked = (typeof SEVERITY)[number];

const rank = (status: OverallStatus): number => {
  const index = (SEVERITY as readonly OverallStatus[]).indexOf(status);
  // An unreadable provider sorts last among the affected, where it never
  // appears anyway: `affected` filters it out first.
  return index === -1 ? SEVERITY.length : index;
};

export interface ProviderGroup {
  /** The slug, as written on the service definitions. */
  id: string;
  /** Member provider ids, in the order the services were declared. */
  providers: string[];
  status: OverallStatus;
  /** Members whose reading is worse than operational, worst first. */
  affected: string[];
}

/**
 * The groups a fleet declares, each with its derived status.
 *
 * Disabled services are left out: a provider nobody is polling cannot make a
 * group unhealthy, and it must not be able to hold one at `unknown` either. A
 * group whose every member is disabled disappears with them.
 */
export function deriveGroups(
  services: readonly ServiceDefinition[],
  statusOf: (providerId: string) => OverallStatus,
): ProviderGroup[] {
  const groups = new Map<string, { providers: string[]; statuses: OverallStatus[] }>();

  for (const service of services) {
    if (service.group === undefined || !service.enabled) continue;
    const entry = groups.get(service.group) ?? { providers: [], statuses: [] };
    entry.providers.push(service.id);
    entry.statuses.push(statusOf(service.id));
    groups.set(service.group, entry);
  }

  return [...groups.entries()]
    .map(([id, entry]) => ({
      id,
      providers: entry.providers,
      status: worstOf(entry.statuses),
      affected: entry.providers
        .filter((_id, index) => {
          const status = entry.statuses[index] as OverallStatus;
          return status !== "operational" && status !== "unknown";
        })
        .sort(
          (a, b) =>
            rank(entry.statuses[entry.providers.indexOf(a)] as OverallStatus) -
            rank(entry.statuses[entry.providers.indexOf(b)] as OverallStatus),
        ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The worst reading in a group, ignoring the ones that are not readings. */
function worstOf(statuses: readonly OverallStatus[]): OverallStatus {
  const readable = statuses.filter((status) => status !== "unknown");
  if (readable.length === 0) return "unknown";
  for (const candidate of SEVERITY as readonly Ranked[]) {
    if (readable.includes(candidate)) return candidate;
  }
  return "operational";
}
