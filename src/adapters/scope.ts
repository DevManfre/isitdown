/**
 * Narrowing a hyperscaler's feed to the regions and services an operator
 * actually runs on — roadmap 2.8. An AWS incident in `ap-south-1` is noise to a
 * fleet in Frankfurt, and on a feed that covers every region on earth the
 * noise is most of what arrives.
 *
 * The same two options on `aws`, `gcp` and `azure`, both comma-separated lists:
 *
 * - `regions` — `eu-west-1`, `europe-west1`, `westeurope`. Compared with case,
 *   spaces and dashes folded away, so Azure's "West Europe" and its API name
 *   `westeurope` are the same region.
 * - `services` — `EC2`, `Compute Engine`, `Virtual Machines`, compared the
 *   same way against the service names the feed itself prints.
 *
 * An incident the feed places nowhere — global, "multiple regions", or simply
 * unlabelled — always passes the region filter, and one that names no service
 * always passes the service filter: those are exactly the incidents a narrowing
 * must not hide.
 */

export interface Scope {
  regions: Set<string> | null;
  services: Set<string> | null;
}

/** `West Europe` → `westeurope`, `eu-west-1` → `euwest1`. */
export const fold = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function list(raw: string | undefined): Set<string> | null {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => fold(entry))
    .filter((entry) => entry !== "");
  return entries.length === 0 ? null : new Set(entries);
}

/** Region names that place an incident nowhere in particular. */
const EVERYWHERE = new Set(["global", "multipleregions", "allregions", "multiregion"]);

/**
 * The scope a provider's options ask for. `fallbackRegion` is an older option
 * name read when `regions` is absent — AWS's single `region`, kept working.
 */
export function scopeOf(options: Record<string, string> | undefined, fallbackRegion?: string): Scope {
  return {
    regions: list(options?.["regions"] ?? (fallbackRegion === undefined ? undefined : options?.[fallbackRegion])),
    services: list(options?.["services"]),
  };
}

/** Whether an incident placed in `regions` and naming `services` is one the scope keeps. */
export function inScope(scope: Scope, regions: readonly string[], services: readonly string[]): boolean {
  if (scope.regions !== null) {
    const placed = regions.map(fold).filter((region) => region !== "");
    const anywhere = placed.length === 0 || placed.some((region) => EVERYWHERE.has(region));
    if (!anywhere && !placed.some((region) => scope.regions!.has(region))) return false;
  }
  if (scope.services !== null) {
    const named = services.map(fold).filter((service) => service !== "" && service !== "multipleservices" && service !== "multipleproducts");
    if (named.length > 0 && !named.some((service) => scope.services!.has(service))) return false;
  }
  return true;
}
