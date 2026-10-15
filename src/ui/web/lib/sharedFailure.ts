import type { OverallStatus } from "./types.ts";

export interface SharedFailureInput {
  id: string;
  name: string;
  enabled: boolean;
  overallStatus: OverallStatus;
}

export interface SharedFailure {
  /** The upstream id the dependents declare. */
  cause: string;
  /** Dependents that are bad right now, worst first, then by id. */
  dependents: SharedFailureInput[];
}

const RANK: Record<OverallStatus, number> = {
  operational: 0,
  unknown: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

/**
 * The upstream that at least two bad providers declare they run on — roadmap
 * 2.9, the live twin of the diff engine's `probableCause`. Same rules: only
 * declared dependencies count (never inferred), `unknown` is not evidence of
 * trouble, and a tie goes to the id that sorts first, so the card and the
 * alert name the same cause.
 */
export function sharedFailure(
  providers: readonly SharedFailureInput[],
  dependsOn: ReadonlyMap<string, readonly string[]>,
): SharedFailure | null {
  const bad = providers.filter((provider) => provider.enabled && RANK[provider.overallStatus] > 0);
  const votes = new Map<string, SharedFailureInput[]>();
  for (const provider of bad) {
    for (const upstream of new Set(dependsOn.get(provider.id) ?? [])) {
      if (upstream === provider.id) continue;
      votes.set(upstream, [...(votes.get(upstream) ?? []), provider]);
    }
  }
  let best: SharedFailure | null = null;
  for (const [upstream, members] of [...votes].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length >= 2 && (best === null || members.length > best.dependents.length)) {
      best = {
        cause: upstream,
        dependents: [...members].sort(
          (a, b) => RANK[b.overallStatus] - RANK[a.overallStatus] || a.id.localeCompare(b.id),
        ),
      };
    }
  }
  return best;
}
