import type { OverallStatus, ProviderStatus, Suspicion } from "./types.ts";

/**
 * What one provider looks like on the dashboard — roadmap 1.3.
 *
 * The one place the three cases are decided, so a tile, a dot and a headline
 * count can never disagree about the same provider:
 *
 *  - no suspicion: the page's own word, drawn plainly;
 *  - a suspicion on a `declared` provider: the measured status, hatched — seen
 *    by our probe, not confirmed by the provider;
 *  - a suspicion on an `observed` provider: the measured status, solid. The
 *    operator has said the probe is the record here (roadmap 9.1), so there is
 *    nothing unconfirmed to mark.
 */
export interface ShownStatus {
  status: OverallStatus;
  /** True when the colour is a suspicion the provider has not declared. */
  hatched: boolean;
  suspicion: Suspicion | null;
}

export function shownStatus(provider: ProviderStatus): ShownStatus {
  const suspicion = provider.suspected ?? null;
  if (suspicion === null) return { status: provider.overallStatus, hatched: false, suspicion: null };
  return { status: suspicion.status, hatched: provider.authority !== "observed", suspicion };
}

/**
 * Whether a provider counts as off the line in the Overview's headline and
 * alarm counts. A hatched suspicion does not — those keep the provider's word
 * and get a line of their own — but an `observed` one does, being the record.
 */
export function isOffLine(provider: ProviderStatus): boolean {
  const shown = shownStatus(provider);
  return !shown.hatched && shown.status !== "operational" && shown.status !== "unknown";
}

/** The providers to list under the headline as suspected — hatched ones only. */
export function suspectedOf(providers: readonly ProviderStatus[]): ProviderStatus[] {
  return providers.filter((provider) => shownStatus(provider).hatched);
}
