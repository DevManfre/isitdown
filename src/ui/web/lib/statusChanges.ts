import { shownStatus } from "./suspicion.ts";
import type { ProviderStatus } from "./types.ts";

/** One provider whose status differs from the last time anyone looked. */
export interface StatusChange {
  id: string;
  name: string;
  status: string;
  /** What it showed before — roadmap 4.27 needs the direction, not only the fact. */
  was: string;
}

/** The status each enabled provider is shown at, by id. */
export function statusById(providers: readonly ProviderStatus[]): Map<string, string> {
  return new Map(providers.filter((provider) => provider.enabled).map((provider) => [provider.id, shownStatus(provider).status]));
}

/**
 * Which providers changed between two reads — roadmap 4.20.
 *
 * What a sighted operator sees happen — a dot turns red — a screen reader user
 * is told nothing about, and this page is driven by a stream: nothing the
 * operator did caused it. So the shell announces it, and this is the decision of
 * *what*. A provider that is new to the list is not a change (the first read,
 * or one just added, has no "before"), and neither is a provider that went away.
 */
export function statusChanges(
  before: ReadonlyMap<string, string>,
  providers: readonly ProviderStatus[],
): StatusChange[] {
  const changes: StatusChange[] = [];
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const was = before.get(provider.id);
    const now = shownStatus(provider).status;
    if (was !== undefined && was !== now) changes.push({ id: provider.id, name: provider.name, status: now, was });
  }
  return changes;
}

/**
 * How bad a shown status is, for deciding whether a move was for the worse —
 * roadmap 4.27 and 4.28. `unknown` is -1 on purpose: a provider that has just
 * stopped being measured, or has just started to be, did not get worse, and a
 * sound for it would cry wolf on every restart.
 */
const RANK: Record<string, number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

export const statusRank = (status: string): number => RANK[status] ?? -1;

/** Whether a change took a provider to a worse reading than it had (from a measured one). */
export const isWorse = (change: StatusChange): boolean =>
  statusRank(change.was) >= 0 && statusRank(change.status) > statusRank(change.was);

/** Whether a change took a provider back up to a better, measured reading. */
export const isBetter = (change: StatusChange): boolean =>
  statusRank(change.status) >= 0 && statusRank(change.status) < statusRank(change.was);
