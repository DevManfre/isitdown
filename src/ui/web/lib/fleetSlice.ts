import type { FleetFilter } from "../../dashboardLayout.ts";
import { overviewShape, type OverviewShape } from "./overviewShape.ts";
import type { ProviderGroupStatus, ProviderStatus } from "./types.ts";

/** The history window the Overview's uptime figures and day bars are read over. */
export const OVERVIEW_WINDOW_DAYS = 90;

export interface FleetSlice {
  /** Enabled providers the filter keeps, in fleet order. */
  providers: ProviderStatus[];
  /** Groups with a member in the slice, or named by the filter. */
  groups: ProviderGroupStatus[];
  /** Mean 90-day uptime, to two places — the figure the Overview always showed. */
  average: number;
  shape: OverviewShape;
  /** The filter narrows the fleet: a widget says so in its caption. */
  filtered: boolean;
  /** A filter that matches nothing — never read as "the whole fleet". */
  empty: boolean;
}

/**
 * The part of the fleet one Overview widget draws — roadmap 4.1.
 *
 * With an empty filter this is exactly what the Overview computed inline before
 * it was composable, so the default layout draws the same numbers. A filter is a
 * union of group members and named providers; a disabled provider stays out
 * either way, as it does everywhere the Overview counts.
 */
export function fleetSlice(
  configured: readonly ProviderStatus[],
  groups: readonly ProviderGroupStatus[],
  filter: FleetFilter,
): FleetSlice {
  const enabled = configured.filter((provider) => provider.enabled);
  const filtered = filter.groups.length > 0 || filter.providers.length > 0;

  let providers = enabled;
  let shownGroups = [...groups];
  if (filtered) {
    const named = new Set(filter.providers);
    for (const group of groups) {
      if (filter.groups.includes(group.id)) for (const id of group.providers) named.add(id);
    }
    providers = enabled.filter((provider) => named.has(provider.id));
    const kept = new Set(providers.map((provider) => provider.id));
    shownGroups = groups.filter(
      (group) => filter.groups.includes(group.id) || group.providers.some((id) => kept.has(id)),
    );
  }

  const average =
    providers.length === 0
      ? 0
      : Math.round((providers.reduce((sum, p) => sum + p.uptime90, 0) / providers.length) * 100) / 100;

  return {
    providers,
    groups: shownGroups,
    average,
    shape: overviewShape(providers.length),
    filtered,
    empty: filtered && providers.length === 0,
  };
}
