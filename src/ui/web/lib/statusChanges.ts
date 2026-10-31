import { shownStatus } from "./suspicion.ts";
import type { ProviderStatus } from "./types.ts";

/** One provider whose status differs from the last time anyone looked. */
export interface StatusChange {
  id: string;
  name: string;
  status: string;
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
    if (was !== undefined && was !== now) changes.push({ id: provider.id, name: provider.name, status: now });
  }
  return changes;
}
