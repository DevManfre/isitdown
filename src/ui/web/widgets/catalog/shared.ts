import { useStatus } from "@/hooks/queries.ts";
import { drawOrder, statusTier } from "@/lib/chartConfig.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import { useFleetSlice } from "../useFleetSlice.ts";

/** How bad a provider is right now, worst first: status tier, then the longer record. */
const badness = (p: ProviderStatus): number => drawOrder(statusTier(p.overallStatus)) * 1000 + (100 - p.uptime90);

/**
 * The provider a one-provider widget left on "follow the fleet" shows: the
 * worst one right now. A tile on its default is therefore always the tile to
 * look at, and a quiet fleet shows its weakest record instead.
 */
export function pickWorst(providers: readonly ProviderStatus[]): ProviderStatus | undefined {
  return [...providers].sort((a, b) => badness(b) - badness(a))[0];
}

/** Display names by id, falling back to the id for one the status no longer lists. */
export function useNames(): (id: string) => string {
  const { data: status } = useStatus();
  const names = new Map((status?.providers ?? []).map((p) => [p.id, p.name]));
  return (id) => names.get(id) ?? id;
}

/**
 * The ids a fleet widget counts, for widgets whose data arrives per provider
 * from another endpoint (incidents, SLA, reliability…) and is narrowed here.
 */
export function useSliceIds(filter: FleetFilter) {
  const slice = useFleetSlice(filter);
  return { ...slice, ids: new Set(slice.providers.map((p) => p.id)) };
}

/** The one provider a provider widget draws: the one it names, or the worst of the fleet. */
export function usePicked(provider: string | null) {
  const { data: status } = useStatus();
  const enabled = (status?.providers ?? []).filter((p) => p.enabled);
  if (provider === null) return { provider: pickWorst(enabled), missing: null };
  const found = enabled.find((p) => p.id === provider);
  return { provider: found, missing: found === undefined ? provider : null };
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;
